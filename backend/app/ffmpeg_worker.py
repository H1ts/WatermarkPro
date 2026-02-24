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


def _build_vf(client_name: str, position: str = "center",
              opacity: int = 30, font_size: int = 48) -> str:
    """Build the -vf filter string for FFmpeg."""
    safe_name = client_name.replace("'", "'\\''").replace(":", "\\:")
    alpha = round(opacity / 100, 2)
    tc_alpha = min(alpha + 0.4, 1.0)

    if position == "diagonal":
        # Repeated diagonal text: 3 lines at 30-degree angle
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


async def process_video(job_id: str, input_path: str, client_name: str,
                        wm_position: str = "center", wm_opacity: int = 30,
                        wm_font_size: int = 48):
    r = redis.from_url(REDIS_URL)

    try:
        await r.hset(f"job:{job_id}", mapping={"status": "processing", "progress": "0"})

        duration = await get_duration(input_path)
        if duration <= 0:
            raise RuntimeError("Cannot determine video duration")

        mp4_output = os.path.join(OUTPUT_DIR, f"{job_id}.mp4")
        hls_dir = os.path.join(HLS_DIR, job_id)
        os.makedirs(hls_dir, exist_ok=True)

        vf = _build_vf(client_name, wm_position, wm_opacity, wm_font_size)

        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-vf", vf,
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
