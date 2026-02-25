import asyncio
import json
import os
import re
import subprocess

import redis.asyncio as redis

from .config import UPLOAD_DIR, OUTPUT_DIR, HLS_DIR, REDIS_URL


def _get_image_aspect(path: str) -> float:
    """Return height/width ratio of an image using ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height",
         "-of", "csv=p=0:s=x", path],
        capture_output=True, text=True,
    )
    try:
        w, h = result.stdout.strip().split("x")
        return int(h) / int(w)
    except (ValueError, ZeroDivisionError):
        return 0.5  # fallback: assume 2:1 landscape logo


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
                    opacity: int = 30, font_size: int = 48,
                    logo_h_expr: str | None = None) -> str:
    """Build drawtext filter chain (text watermark + timecode).

    x_pct/y_pct: 0-100 percentage of video dimensions for watermark center.
    logo_h_expr: when set, FFmpeg expression for logo height + gap; text shifts
                 up so the combined text+logo block is centered at y_pct.
    """
    safe_name = client_name.replace("'", "'\\''").replace(":", "\\:")
    alpha = round(1 - opacity / 100, 2)
    tc_alpha = min(alpha + 0.4, 1.0)

    x_expr = f"w*{x_pct}/100-text_w/2"
    if logo_h_expr:
        # Center combined block: text_top = center - (text_h + logo_h_total)/2
        y_expr = f"h*{y_pct}/100-(text_h+{logo_h_expr})/2"
    else:
        y_expr = f"h*{y_pct}/100-text_h/2"

    wm_filter = (
        f"drawtext=text='{safe_name}'"
        f":fontsize={font_size}:fontcolor=white@{alpha}"
        f":x={x_expr}:y={y_expr}"
    )

    # Timecode at top-center
    timecode = (
        f"drawtext=timecode='00\\:00\\:00\\:00'"
        f":rate=25:fontsize=36:fontcolor=white@{tc_alpha}"
        f":x=(w-text_w)/2:y=20"
    )

    return f"{wm_filter},{timecode}"


def build_ffmpeg_filter(client_name: str, x_pct: float = 50.0, y_pct: float = 50.0,
                        opacity: int = 30, font_size: int = 48,
                        logo_path: str | None = None, logo_scale: int = 25):
    """Return (extra_inputs, filter_flag, filter_value) for FFmpeg command.

    x_pct/y_pct: 0-100 percentage coordinates for watermark center.
    logo_scale: logo width as percentage of video width (10-50).
    """
    alpha = round(1 - opacity / 100, 2)

    if not logo_path:
        drawtext = _build_drawtext(client_name, x_pct, y_pct, opacity, font_size)
        return [], "-vf", drawtext

    gap = max(10, font_size // 4)
    scale_frac = round(logo_scale / 100, 2)

    # Get real logo aspect ratio for accurate positioning
    logo_aspect = round(_get_image_aspect(logo_path), 4)
    # Scaled logo height = video_width * scale_frac * logo_aspect
    # In FFmpeg drawtext expressions, w = video width
    logo_h_est = f"w*{scale_frac}*{logo_aspect}"

    # In overlay expressions: w/h = overlay (logo) dims, W/H = main video dims.
    # Center the combined block (text + gap + logo) at the marker point.
    # text_h isn't available in overlay expr, so approximate as font_size.
    fs = font_size
    overlay_x = f"W*{x_pct}/100-w/2"
    overlay_y = f"H*{y_pct}/100+({fs}+{gap})/2-h/2"

    # For drawtext: use real logo dimensions for accurate centering
    logo_h_expr = f"{gap}+{logo_h_est}"
    drawtext = _build_drawtext(client_name, x_pct, y_pct, opacity, font_size,
                               logo_h_expr=logo_h_expr)

    fc = (
        f"[1:v][0:v]scale2ref=w='ref_w*{scale_frac}':h='ow*ih/iw'[logo][base];"
        f"[logo]format=rgba,colorchannelmixer=aa={alpha}[logoalpha];"
        f"[base][logoalpha]overlay={overlay_x}:{overlay_y},"
        f"{drawtext}"
    )
    return ["-i", logo_path], "-filter_complex", fc


QUALITY_PRESETS = {
    "low":    {"preset": "ultrafast", "crf": "28"},
    "medium": {"preset": "medium",    "crf": "23"},
    "high":   {"preset": "slow",      "crf": "18"},
}


async def process_video(job_id: str, input_path: str, client_name: str,
                        wm_x: float = 50.0, wm_y: float = 50.0,
                        wm_opacity: int = 30, wm_font_size: int = 48,
                        logo_path: str | None = None, logo_scale: int = 25,
                        quality: str = "medium", codec: str = "mp4"):
    r = redis.from_url(REDIS_URL)

    try:
        await r.hset(f"job:{job_id}", mapping={"status": "processing", "progress": "0"})

        duration = await get_duration(input_path)
        if duration <= 0:
            raise RuntimeError("Cannot determine video duration")

        ext = ".mov" if codec == "mov" else ".mp4"
        output_file = os.path.join(OUTPUT_DIR, f"{job_id}{ext}")
        hls_dir = os.path.join(HLS_DIR, job_id)
        os.makedirs(hls_dir, exist_ok=True)

        extra_inputs, filter_flag, filter_val = build_ffmpeg_filter(
            client_name, wm_x, wm_y, wm_opacity, wm_font_size,
            logo_path, logo_scale,
        )

        qp = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["medium"])

        cmd = [
            "ffmpeg", "-y", "-loglevel", "warning", "-i", input_path,
            *extra_inputs,
            filter_flag, filter_val,
            "-c:v", "libx264", "-preset", qp["preset"], "-crf", qp["crf"],
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-progress", "pipe:1",
            output_file,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Drain stderr concurrently to prevent pipe buffer deadlock
        async def _drain(stream):
            chunks = []
            while True:
                chunk = await stream.read(8192)
                if not chunk:
                    break
                chunks.append(chunk)
            return b"".join(chunks)

        stderr_task = asyncio.create_task(_drain(proc.stderr))

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

        stderr_out = await stderr_task
        await proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg encode failed: {stderr_out.decode()[:500]}")

        await r.hset(f"job:{job_id}", "progress", "85")

        hls_cmd = [
            "ffmpeg", "-y", "-i", output_file,
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
