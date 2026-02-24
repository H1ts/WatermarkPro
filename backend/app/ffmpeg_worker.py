import asyncio
import json
import os
import re
import subprocess

import redis.asyncio as redis

from .config import UPLOAD_DIR, OUTPUT_DIR, HLS_DIR, REDIS_URL


async def get_duration(input_path: str) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    try:
        return float(stdout.decode().strip())
    except ValueError:
        return 0.0


def _build_position(position: str, is_timecode: bool = False):
    """Return (x, y) expressions for FFmpeg drawtext based on position name."""
    margin = "20"
    if is_timecode:
        return "(w-text_w)/2", "h-th-20"

    positions = {
        "center": ("(w-text_w)/2", "(h-text_h)/2"),
        "top-left": (margin, margin),
        "top-right": (f"w-text_w-{margin}", margin),
        "bottom-left": (margin, f"h-text_h-{margin}"),
        "bottom-right": (f"w-text_w-{margin}", f"h-text_h-{margin}"),
    }
    return positions.get(position, positions["center"])


def _logo_overlay_pos(position: str) -> str:
    """Return overlay x:y expression for logo placement."""
    margin = "20"
    positions = {
        "center": "(W-w)/2:(H-h)/2",
        "top-left": f"{margin}:{margin}",
        "top-right": f"W-w-{margin}:{margin}",
        "bottom-left": f"{margin}:H-h-{margin}",
        "bottom-right": f"W-w-{margin}:H-h-{margin}",
        "diagonal": "(W-w)/2:(H-h)/2",
    }
    return positions.get(position, positions["center"])


def _build_drawtext(client_name: str, position: str = "center",
                    opacity: int = 30, font_size: int = 48) -> str:
    """Build drawtext filter chain (text watermark + timecode)."""
    safe_name = client_name.replace("'", "'\\''").replace(":", "\\:")
    alpha = round(opacity / 100, 2)
    tc_alpha = min(alpha + 0.4, 1.0)

    if position == "diagonal":
        lines = []
        offsets = [
            ("(w-text_w)/2", "(h/4-text_h/2)"),
            ("(w-text_w)/2", "(h/2-text_h/2)"),
            ("(w-text_w)/2", "(3*h/4-text_h/2)"),
        ]
        for x, y in offsets:
            lines.append(
                f"drawtext=text='{safe_name}'"
                f":fontsize={font_size}:fontcolor=white@{alpha}"
                f":x={x}:y={y}"
            )
        wm_filter = ",".join(lines)
    else:
        x, y = _build_position(position)
        wm_filter = (
            f"drawtext=text='{safe_name}'"
            f":fontsize={font_size}:fontcolor=white@{alpha}"
            f":x={x}:y={y}"
        )

    tc_x, tc_y = _build_position(position, is_timecode=True)
    timecode = (
        f"drawtext=timecode='00\\:00\\:00\\:00'"
        f":rate=25:fontsize=24:fontcolor=white@{tc_alpha}"
        f":x={tc_x}:y={tc_y}"
    )

    return f"{wm_filter},{timecode}"


def build_ffmpeg_filter(client_name: str, position: str = "center",
                        opacity: int = 30, font_size: int = 48,
                        logo_path: str | None = None):
    """Return (extra_inputs, filter_flag, filter_value) for FFmpeg command.

    Without logo: returns ([], "-vf", "drawtext...")
    With logo: returns (["-i", logo_path], "-filter_complex", "...overlay...drawtext...")
    """
    drawtext = _build_drawtext(client_name, position, opacity, font_size)
    alpha = round(opacity / 100, 2)

    if not logo_path:
        return [], "-vf", drawtext

    overlay_pos = _logo_overlay_pos(position)
    # Scale logo to max 15% of video width, preserve aspect ratio, apply opacity
    fc = (
        f"[1:v]scale='min(iw,main_w*0.15)':-1,format=rgba,"
        f"colorchannelmixer=aa={alpha}[logo];"
        f"[0:v][logo]overlay={overlay_pos},"
        f"{drawtext}"
    )
    return ["-i", logo_path], "-filter_complex", fc


async def process_video(job_id: str, input_path: str, client_name: str,
                        wm_position: str = "center", wm_opacity: int = 30,
                        wm_font_size: int = 48, logo_path: str | None = None):
    r = redis.from_url(REDIS_URL)

    try:
        await r.hset(f"job:{job_id}", mapping={"status": "processing", "progress": "0"})

        duration = await get_duration(input_path)
        if duration <= 0:
            raise RuntimeError("Cannot determine video duration")

        mp4_output = os.path.join(OUTPUT_DIR, f"{job_id}.mp4")
        hls_dir = os.path.join(HLS_DIR, job_id)
        os.makedirs(hls_dir, exist_ok=True)

        extra_inputs, filter_flag, filter_val = build_ffmpeg_filter(
            client_name, wm_position, wm_opacity, wm_font_size, logo_path
        )

        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            *extra_inputs,
            filter_flag, filter_val,
            "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-progress", "pipe:1",
            mp4_output,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            decoded = line.decode("utf-8", errors="replace").strip()
            m = re.match(r"out_time_ms=(\d+)", decoded)
            if m and duration > 0:
                current_sec = int(m.group(1)) / 1_000_000
                progress = min(int((current_sec / duration) * 80), 80)
                await r.hset(f"job:{job_id}", "progress", str(progress))

        await proc.wait()
        if proc.returncode != 0:
            stderr_out = await proc.stderr.read()
            raise RuntimeError(f"FFmpeg MP4 failed: {stderr_out.decode()[:500]}")

        await r.hset(f"job:{job_id}", "progress", "85")

        hls_cmd = [
            "ffmpeg", "-y", "-i", mp4_output,
            "-c:v", "copy", "-c:a", "copy",
            "-f", "hls",
            "-hls_time", "6",
            "-hls_list_size", "0",
            "-hls_segment_filename", os.path.join(hls_dir, "seg_%03d.ts"),
            os.path.join(hls_dir, "index.m3u8"),
        ]

        proc2 = await asyncio.create_subprocess_exec(
            *hls_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc2.communicate()
        if proc2.returncode != 0:
            raise RuntimeError("FFmpeg HLS segmentation failed")

        await r.hset(f"job:{job_id}", mapping={
            "status": "done",
            "progress": "100",
        })

    except Exception as e:
        await r.hset(f"job:{job_id}", mapping={
            "status": "error",
            "error": str(e)[:500],
        })
    finally:
        await r.aclose()
