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


async def process_video(job_id: str, input_path: str, client_name: str):
    r = redis.from_url(REDIS_URL)

    try:
        await r.hset(f"job:{job_id}", mapping={"status": "processing", "progress": "0"})

        duration = await get_duration(input_path)
        if duration <= 0:
            raise RuntimeError("Cannot determine video duration")

        mp4_output = os.path.join(OUTPUT_DIR, f"{job_id}.mp4")
        hls_dir = os.path.join(HLS_DIR, job_id)
        os.makedirs(hls_dir, exist_ok=True)

        safe_name = client_name.replace("'", "'\\''").replace(":", "\\:")
        vf = (
            f"drawtext=text='{safe_name}'"
            f":fontsize=48:fontcolor=white@0.3"
            f":x=(w-text_w)/2:y=(h-text_h)/2,"
            f"drawtext=timecode='00\\:00\\:00\\:00'"
            f":rate=25:fontsize=24:fontcolor=white@0.7"
            f":x=(w-text_w)/2:y=h-th-20"
        )

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
