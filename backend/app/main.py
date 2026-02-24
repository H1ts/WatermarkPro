import asyncio
import os
import uuid

import aiofiles
import redis.asyncio as redis
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from .config import UPLOAD_DIR, OUTPUT_DIR, HLS_DIR, REDIS_URL, BASE_URL
from .models import ProcessRequest, JobInfo, JobStatus
from .ffmpeg_worker import process_video

app = FastAPI(title="WatermarkPro API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _redis():
    return redis.from_url(REDIS_URL)


@app.on_event("startup")
async def startup():
    for d in [UPLOAD_DIR, OUTPUT_DIR, HLS_DIR]:
        os.makedirs(d, exist_ok=True)


@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    file_id = uuid.uuid4().hex[:12]
    ext = os.path.splitext(file.filename or "video.mp4")[1]
    dest = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")

    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            await f.write(chunk)

    r = _redis()
    await r.hset(f"file:{file_id}", mapping={
        "filename": file.filename or "video.mp4",
        "path": dest,
        "size": str(os.path.getsize(dest)),
    })
    await r.aclose()

    return {"file_id": file_id, "filename": file.filename, "size": os.path.getsize(dest)}


@app.post("/process")
async def process(req: ProcessRequest):
    r = _redis()
    file_data = await r.hgetall(f"file:{req.file_id}")
    if not file_data:
        await r.aclose()
        raise HTTPException(status_code=404, detail="File not found")

    job_id = uuid.uuid4().hex[:12]
    input_path = file_data[b"path"].decode()
    filename = file_data[b"filename"].decode()

    await r.hset(f"job:{job_id}", mapping={
        "status": "pending",
        "progress": "0",
        "filename": filename,
        "client_name": req.client_name,
        "file_id": req.file_id,
        "wm_position": req.wm_position.value,
        "wm_opacity": str(req.wm_opacity),
        "wm_font_size": str(req.wm_font_size),
    })
    await r.aclose()

    asyncio.create_task(process_video(
        job_id, input_path, req.client_name,
        wm_position=req.wm_position.value,
        wm_opacity=req.wm_opacity,
        wm_font_size=req.wm_font_size,
    ))

    return {
        "job_id": job_id,
        "status": "pending",
        "watch_url": f"{BASE_URL}/watch/{job_id}",
    }


@app.get("/status/{job_id}")
async def status(job_id: str):
    r = _redis()
    data = await r.hgetall(f"job:{job_id}")
    await r.aclose()

    if not data:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobInfo(
        id=job_id,
        status=JobStatus(data.get(b"status", b"pending").decode()),
        progress=int(data.get(b"progress", b"0").decode()),
        filename=data.get(b"filename", b"").decode() or None,
        client_name=data.get(b"client_name", b"").decode() or None,
        watch_url=f"{BASE_URL}/watch/{job_id}" if data.get(b"status") == b"done" else None,
        error=data.get(b"error", b"").decode() or None,
    )


@app.get("/watch/{job_id}", response_class=HTMLResponse)
async def watch(job_id: str):
    r = _redis()
    data = await r.hgetall(f"job:{job_id}")
    await r.aclose()

    if not data:
        raise HTTPException(status_code=404, detail="Job not found")

    status_val = data.get(b"status", b"").decode()
    if status_val != "done":
        return HTMLResponse(
            content=f"<html><body><h2>Video is still processing ({status_val})...</h2>"
                    f"<p>Refresh the page to check again.</p></body></html>",
            status_code=200,
        )

    client_name = data.get(b"client_name", b"").decode()
    filename = data.get(b"filename", b"").decode()
    hls_url = f"/hls/{job_id}/index.m3u8"

    return HTMLResponse(content=f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WatermarkPro — {filename}</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ background: #0f0f0f; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
               display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 20px; }}
        .header {{ text-align: center; margin-bottom: 20px; }}
        .header h1 {{ font-size: 18px; font-weight: 600; color: #a78bfa; }}
        .header p {{ font-size: 14px; color: #888; margin-top: 4px; }}
        .player-wrap {{ width: 100%; max-width: 960px; background: #000; border-radius: 8px; overflow: hidden; }}
        video {{ width: 100%; display: block; }}
        .info {{ margin-top: 12px; font-size: 13px; color: #666; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>WatermarkPro</h1>
        <p>{filename} &mdash; {client_name}</p>
    </div>
    <div class="player-wrap">
        <video id="video" controls></video>
    </div>
    <p class="info">This video is protected. Download is disabled.</p>
    <script>
        const video = document.getElementById('video');
        const src = '{hls_url}';
        if (Hls.isSupported()) {{
            const hls = new Hls();
            hls.loadSource(src);
            hls.attachMedia(video);
        }} else if (video.canPlayType('application/vnd.apple.mpegurl')) {{
            video.src = src;
        }}
        video.addEventListener('contextmenu', e => e.preventDefault());
    </script>
</body>
</html>""")


@app.get("/health")
async def health():
    return {"status": "ok"}
