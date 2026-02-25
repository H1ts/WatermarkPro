import asyncio
import os
import uuid
from datetime import datetime, timezone

import aiofiles
import redis.asyncio as redis
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from .config import UPLOAD_DIR, OUTPUT_DIR, HLS_DIR, REDIS_URL, BASE_URL
from .models import (  # noqa: F401
    ProcessRequest, JobInfo, JobStatus,
    CreateProjectRequest, ProjectInfo, ProjectDetail,
)
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


# ── Projects ──────────────────────────────────────────────────────────

@app.post("/projects")
async def create_project(req: CreateProjectRequest):
    project_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    r = _redis()
    await r.hset(f"project:{project_id}", mapping={
        "name": req.name,
        "created_at": now,
    })
    await r.sadd("projects", project_id)
    await r.aclose()
    return ProjectInfo(id=project_id, name=req.name, created_at=now, job_count=0)


@app.get("/projects")
async def list_projects():
    r = _redis()
    project_ids = await r.smembers("projects")
    projects = []
    for pid_bytes in project_ids:
        pid = pid_bytes.decode() if isinstance(pid_bytes, bytes) else pid_bytes
        data = await r.hgetall(f"project:{pid}")
        if not data:
            continue
        job_count = await r.scard(f"project:{pid}:jobs")
        projects.append(ProjectInfo(
            id=pid,
            name=data.get(b"name", b"").decode(),
            created_at=data.get(b"created_at", b"").decode(),
            job_count=job_count,
        ))
    await r.aclose()
    projects.sort(key=lambda p: p.created_at, reverse=True)
    return projects


@app.get("/projects/{project_id}")
async def get_project(project_id: str):
    r = _redis()
    data = await r.hgetall(f"project:{project_id}")
    if not data:
        await r.aclose()
        raise HTTPException(status_code=404, detail="Project not found")

    job_ids = await r.smembers(f"project:{project_id}:jobs")
    jobs = []
    for jid_bytes in job_ids:
        jid = jid_bytes.decode() if isinstance(jid_bytes, bytes) else jid_bytes
        jdata = await r.hgetall(f"job:{jid}")
        if not jdata:
            continue
        status_val = jdata.get(b"status", b"pending").decode()
        jobs.append(JobInfo(
            id=jid,
            status=JobStatus(status_val),
            progress=int(jdata.get(b"progress", b"0").decode()),
            filename=jdata.get(b"filename", b"").decode() or None,
            client_name=jdata.get(b"client_name", b"").decode() or None,
            watch_url=f"{BASE_URL}/watch/{jid}" if status_val == "done" else None,
            error=jdata.get(b"error", b"").decode() or None,
        ))
    await r.aclose()

    jobs.sort(key=lambda j: j.id, reverse=True)
    return ProjectDetail(
        id=project_id,
        name=data.get(b"name", b"").decode(),
        created_at=data.get(b"created_at", b"").decode(),
        jobs=jobs,
    )


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    r = _redis()
    exists = await r.exists(f"project:{project_id}")
    if not exists:
        await r.aclose()
        raise HTTPException(status_code=404, detail="Project not found")
    await r.delete(f"project:{project_id}")
    await r.srem("projects", project_id)
    await r.delete(f"project:{project_id}:jobs")
    await r.aclose()
    return {"ok": True}


# ── File upload ───────────────────────────────────────────────────────

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


LOGO_DIR = os.path.join(UPLOAD_DIR, "logos")

ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_LOGO_SIZE = 5 * 1024 * 1024  # 5 MB


@app.post("/upload-logo")
async def upload_logo(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG and WebP are allowed")

    os.makedirs(LOGO_DIR, exist_ok=True)
    logo_id = uuid.uuid4().hex[:12]
    ext = os.path.splitext(file.filename or "logo.png")[1] or ".png"
    dest = os.path.join(LOGO_DIR, f"{logo_id}{ext}")

    size = 0
    async with aiofiles.open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_LOGO_SIZE:
                await f.close()
                os.remove(dest)
                raise HTTPException(status_code=400, detail="Logo file too large (max 5 MB)")
            await f.write(chunk)

    r = _redis()
    await r.hset(f"logo:{logo_id}", mapping={
        "filename": file.filename or "logo.png",
        "path": dest,
        "size": str(size),
    })
    await r.aclose()

    return {"logo_id": logo_id, "filename": file.filename, "size": size}


@app.post("/process")
async def process(req: ProcessRequest):
    r = _redis()
    file_data = await r.hgetall(f"file:{req.file_id}")
    if not file_data:
        await r.aclose()
        raise HTTPException(status_code=404, detail="File not found")

    logo_path = None
    if req.logo_id:
        logo_data = await r.hgetall(f"logo:{req.logo_id}")
        if not logo_data:
            await r.aclose()
            raise HTTPException(status_code=404, detail="Logo not found")
        logo_path = logo_data[b"path"].decode()

    job_id = uuid.uuid4().hex[:12]
    input_path = file_data[b"path"].decode()
    filename = file_data[b"filename"].decode()

    job_mapping = {
        "status": "pending",
        "progress": "0",
        "filename": filename,
        "client_name": req.client_name,
        "file_id": req.file_id,
        "wm_x": str(req.wm_x),
        "wm_y": str(req.wm_y),
        "wm_opacity": str(req.wm_opacity),
        "wm_font_size": str(req.wm_font_size),
        "logo_scale": str(req.logo_scale),
    }
    if req.logo_id:
        job_mapping["logo_id"] = req.logo_id
    if req.project_id:
        job_mapping["project_id"] = req.project_id
    await r.hset(f"job:{job_id}", mapping=job_mapping)
    if req.project_id:
        await r.sadd(f"project:{req.project_id}:jobs", job_id)
    await r.aclose()

    asyncio.create_task(process_video(
        job_id, input_path, req.client_name,
        wm_x=req.wm_x,
        wm_y=req.wm_y,
        wm_opacity=req.wm_opacity,
        wm_font_size=req.wm_font_size,
        logo_path=logo_path,
        logo_scale=req.logo_scale,
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
