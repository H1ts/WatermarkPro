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


def _build_drawtext(client_name: str, x_pct: float = 50.0, y_pct: float = 50.0,
                    opacity: int = 30, font_size: int = 48) -> str:
    """Build drawtext filter chain (text watermark + timecode).

    x_pct/y_pct: 0-100 percentage of video dimensions for watermark center.
    """
    safe_name = client_name.replace("'", "'\\''").replace(":", "\\:")
    # opacity = transparency percentage, so invert for FFmpeg alpha (visibility)
    alpha = round(1 - opacity / 100, 2)
    tc_alpha = min(alpha + 0.4, 1.0)

    # Position text centered at x_pct/y_pct of the video
    x_expr = f"w*{x_pct}/100-text_w/2"
    y_expr = f"h*{y_pct}/100-text_h/2"

    wm_filter = (
        f"drawtext=text='{safe_name}'"
        f":fontsize={font_size}:fontcolor=white@{alpha}"
        f":x={x_expr}:y={y_expr}"
    )

    # Timecode always at bottom-center
    timecode = (
        f"drawtext=timecode='00\\:00\\:00\\:00'"
        f":rate=25:fontsize=24:fontcolor=white@{tc_alpha}"
        f":x=(w-text_w)/2:y=h-th-20"
    )

    return f"{wm_filter},{timecode}"


def build_ffmpeg_filter(client_name: str, x_pct: float = 50.0, y_pct: float = 50.0,
                        opacity: int = 30, font_size: int = 48,
                        logo_path: str | None = None, logo_scale: int = 25):
    """Return (extra_inputs, filter_flag, filter_value) for FFmpeg command.

    x_pct/y_pct: 0-100 percentage coordinates for watermark center.
    logo_scale: logo width as percentage of video width (10-50).
    """
    drawtext = _build_drawtext(client_name, x_pct, y_pct, opacity, font_size)
    alpha = round(1 - opacity / 100, 2)

    if not logo_path:
        return [], "-vf", drawtext

    # Logo overlay position: center logo at x_pct/y_pct
    overlay_x = f"W*{x_pct}/100-w/2"
    overlay_y = f"H*{y_pct}/100-h/2"

    scale_frac = round(logo_scale / 100, 2)

    # scale2ref scales logo relative to main video
    fc = (
        f"[1:v][0:v]scale2ref=w='min(iw,ref_w*{scale_frac})':h='ow*ih/iw'[logo][base];"
        f"[logo]format=rgba,colorchannelmixer=aa={alpha}[logoalpha];"
        f"[base][logoalpha]overlay={overlay_x}:{overlay_y},"
        f"{drawtext}"
    )
    return ["-i", logo_path], "-filter_complex", fc


async def process_video(job_id: str, input_path: str, client_name: str,
                        wm_x: float = 50.0, wm_y: float = 50.0,
                        wm_opacity: int = 30, wm_font_size: int = 48,
                        logo_path: str | None = None, logo_scale: int = 25):
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
            client_name, wm_x, wm_y, wm_opacity, wm_font_size,
            logo_path, logo_scale,
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
