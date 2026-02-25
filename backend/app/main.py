import asyncio
import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timezone

import aiofiles
import redis.asyncio as redis
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse

from .config import UPLOAD_DIR, OUTPUT_DIR, HLS_DIR, REDIS_URL, BASE_URL
from .models import (  # noqa: F401
    ProcessRequest, JobInfo, JobStatus, VersionInfo,
    CreateProjectRequest, ProjectInfo, ProjectDetail,
    SetPasswordRequest, VerifyPasswordRequest,
    CreateCommentRequest, UpdateCommentRequest, CommentInfo,
)
from .ffmpeg_worker import process_video

HLS_SECRET = os.environ.get("HLS_SECRET", secrets.token_hex(32))

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
        is_done = status_val == "done"
        jobs.append(JobInfo(
            id=jid,
            status=JobStatus(status_val),
            progress=int(jdata.get(b"progress", b"0").decode()),
            filename=jdata.get(b"filename", b"").decode() or None,
            client_name=jdata.get(b"client_name", b"").decode() or None,
            watch_url=f"{BASE_URL}/watch/{jid}" if is_done else None,
            share_url=f"{BASE_URL}/share/{jid}" if is_done else None,
            download_url=f"{BASE_URL}/api/download/{jid}" if is_done else None,
            codec=jdata.get(b"codec", b"mp4").decode(),
            has_password=bool(jdata.get(b"share_password_hash", b"").decode()),
            version=int(jdata.get(b"version", b"1").decode()),
            parent_job_id=jdata.get(b"parent_job_id", b"").decode() or None,
            review_status=jdata.get(b"review_status", b"pending_review").decode(),
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

    # Версионность: определяем номер версии
    version = 1
    root_job_id = job_id  # корневой job для цепочки версий
    now = datetime.now(timezone.utc).isoformat()
    if req.parent_job_id:
        parent_data = await r.hgetall(f"job:{req.parent_job_id}")
        if parent_data:
            parent_version = int(parent_data.get(b"version", b"1").decode())
            version = parent_version + 1
            root_job_id = parent_data.get(b"root_job_id", b"").decode() or req.parent_job_id

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
        "quality": req.quality,
        "codec": req.codec,
        "version": str(version),
        "root_job_id": root_job_id,
        "review_status": "pending_review",
        "created_at": now,
    }
    if req.parent_job_id:
        job_mapping["parent_job_id"] = req.parent_job_id
    if req.logo_id:
        job_mapping["logo_id"] = req.logo_id
    if req.project_id:
        job_mapping["project_id"] = req.project_id
    await r.hset(f"job:{job_id}", mapping=job_mapping)
    # Добавляем в цепочку версий
    await r.rpush(f"versions:{root_job_id}", job_id)
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
        quality=req.quality,
        codec=req.codec,
    ))

    return {
        "job_id": job_id,
        "status": "pending",
        "watch_url": f"{BASE_URL}/watch/{job_id}",
        "share_url": f"{BASE_URL}/share/{job_id}",
    }


@app.get("/status/{job_id}")
async def status(job_id: str):
    r = _redis()
    data = await r.hgetall(f"job:{job_id}")
    await r.aclose()

    if not data:
        raise HTTPException(status_code=404, detail="Job not found")

    is_done = data.get(b"status") == b"done"
    return JobInfo(
        id=job_id,
        status=JobStatus(data.get(b"status", b"pending").decode()),
        progress=int(data.get(b"progress", b"0").decode()),
        filename=data.get(b"filename", b"").decode() or None,
        client_name=data.get(b"client_name", b"").decode() or None,
        watch_url=f"{BASE_URL}/watch/{job_id}" if is_done else None,
        share_url=f"{BASE_URL}/share/{job_id}" if is_done else None,
        download_url=f"{BASE_URL}/api/download/{job_id}" if is_done else None,
        codec=data.get(b"codec", b"mp4").decode(),
        fps=int(data.get(b"fps", b"25").decode()),
        has_password=bool(data.get(b"share_password_hash", b"").decode()),
        version=int(data.get(b"version", b"1").decode()),
        parent_job_id=data.get(b"parent_job_id", b"").decode() or None,
        review_status=data.get(b"review_status", b"pending_review").decode(),
        error=data.get(b"error", b"").decode() or None,
    )


@app.get("/download/{job_id}")
async def download(job_id: str):
    r = _redis()
    data = await r.hgetall(f"job:{job_id}")
    await r.aclose()

    if not data:
        raise HTTPException(status_code=404, detail="Job not found")

    if data.get(b"status", b"").decode() != "done":
        raise HTTPException(status_code=400, detail="Video is still processing")

    job_codec = data.get(b"codec", b"mp4").decode()
    ext = ".mov" if job_codec == "mov" else ".mp4"
    output_path = os.path.join(OUTPUT_DIR, f"{job_id}{ext}")
    if not os.path.isfile(output_path):
        # fallback: try the other extension
        alt_ext = ".mp4" if ext == ".mov" else ".mov"
        output_path = os.path.join(OUTPUT_DIR, f"{job_id}{alt_ext}")
        ext = alt_ext
    if not os.path.isfile(output_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    filename = data.get(b"filename", b"video").decode()
    base = os.path.splitext(filename)[0]
    filename = base + ext
    media_type = "video/quicktime" if ext == ".mov" else "video/mp4"

    return FileResponse(
        output_path,
        media_type=media_type,
        filename=filename,
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


# ── Version control ──────────────────────────────────────────────────

@app.get("/versions/{job_id}")
async def list_versions(job_id: str):
    """Возвращает все версии для данного job (от корневого)."""
    r = _redis()
    # Определяем корневой job
    data = await r.hgetall(f"job:{job_id}")
    if not data:
        await r.aclose()
        raise HTTPException(status_code=404, detail="Job not found")
    root_id = data.get(b"root_job_id", b"").decode() or job_id

    # Читаем цепочку версий
    version_ids = await r.lrange(f"versions:{root_id}", 0, -1)
    versions = []
    for vid_bytes in version_ids:
        vid = vid_bytes.decode() if isinstance(vid_bytes, bytes) else vid_bytes
        vdata = await r.hgetall(f"job:{vid}")
        if not vdata:
            continue
        versions.append(VersionInfo(
            job_id=vid,
            version=int(vdata.get(b"version", b"1").decode()),
            filename=vdata.get(b"filename", b"").decode() or None,
            status=JobStatus(vdata.get(b"status", b"pending").decode()),
            created_at=vdata.get(b"created_at", b"").decode() or None,
        ))
    await r.aclose()

    # Если цепочка пуста (старый job без версий), возвращаем один элемент
    if not versions:
        versions.append(VersionInfo(
            job_id=job_id,
            version=int(data.get(b"version", b"1").decode()),
            filename=data.get(b"filename", b"").decode() or None,
            status=JobStatus(data.get(b"status", b"pending").decode()),
            created_at=data.get(b"created_at", b"").decode() or None,
        ))

    versions.sort(key=lambda v: v.version)
    return versions


# ── Share password ───────────────────────────────────────────────────

def _hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


@app.post("/share/{job_id}/password")
async def set_share_password(job_id: str, req: SetPasswordRequest):
    r = _redis()
    exists = await r.exists(f"job:{job_id}")
    if not exists:
        await r.aclose()
        raise HTTPException(status_code=404, detail="Job not found")
    if req.password:
        await r.hset(f"job:{job_id}", "share_password_hash", _hash_password(req.password))
    else:
        await r.hdel(f"job:{job_id}", "share_password_hash")
    await r.aclose()
    return {"ok": True, "has_password": bool(req.password)}


@app.post("/share/{job_id}/verify")
async def verify_share_password(job_id: str, req: VerifyPasswordRequest):
    r = _redis()
    data = await r.hgetall(f"job:{job_id}")
    await r.aclose()
    if not data:
        raise HTTPException(status_code=404, detail="Job not found")
    stored_hash = data.get(b"share_password_hash", b"").decode()
    if not stored_hash:
        return {"ok": True, "token": "open"}
    if _hash_password(req.password) != stored_hash:
        raise HTTPException(status_code=403, detail="Неверный пароль")
    token = secrets.token_urlsafe(32)
    r2 = _redis()
    await r2.setex(f"share_token:{job_id}:{token}", 3600, "1")
    await r2.aclose()
    return {"ok": True, "token": token}


@app.get("/share/{job_id}/check")
async def check_share_access(job_id: str):
    """Проверяет, нужен ли пароль для данного job."""
    r = _redis()
    data = await r.hgetall(f"job:{job_id}")
    await r.aclose()
    if not data:
        raise HTTPException(status_code=404, detail="Job not found")
    has_pw = bool(data.get(b"share_password_hash", b"").decode())
    return {"has_password": has_pw}


# ── HLS signed tokens ───────────────────────────────────────────────

import time

def _sign_hls_token(job_id: str, expires: int) -> str:
    """Генерирует HMAC-подпись для HLS-доступа."""
    msg = f"{job_id}:{expires}"
    sig = hmac.new(HLS_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{expires}:{sig}"


def _verify_hls_token(job_id: str, token: str) -> bool:
    """Проверяет HMAC-подпись HLS-токена."""
    try:
        parts = token.split(":")
        if len(parts) != 2:
            return False
        expires = int(parts[0])
        if time.time() > expires:
            return False
        expected = _sign_hls_token(job_id, expires)
        return hmac.compare_digest(token, expected)
    except (ValueError, TypeError):
        return False


@app.get("/hls-token/{job_id}")
async def get_hls_token(job_id: str):
    """Выдаёт подписанный токен для HLS-доступа (10 мин)."""
    r = _redis()
    exists = await r.exists(f"job:{job_id}")
    await r.aclose()
    if not exists:
        raise HTTPException(status_code=404, detail="Job not found")
    expires = int(time.time()) + 600  # 10 минут
    token = _sign_hls_token(job_id, expires)
    return {"token": token, "expires": expires}


from fastapi import Request, Response

@app.get("/auth/hls")
async def auth_hls(request: Request):
    """Nginx auth_request: проверяет токен для HLS-сегментов."""
    uri = request.headers.get("X-Original-URI", "")
    # Извлекаем job_id из URI: /hls/{job_id}/...
    parts = uri.strip("/").split("/")
    if len(parts) < 2 or parts[0] != "hls":
        return Response(status_code=403)

    job_id = parts[1]
    token = request.query_params.get("token") or request.headers.get("X-HLS-Token", "")

    if not token:
        # Проверяем cookie
        token = request.cookies.get("hls_token", "")

    if not token or not _verify_hls_token(job_id, token):
        return Response(status_code=403)

    return Response(status_code=200)


# ── Comments (review) ────────────────────────────────────────────────

@app.post("/comments")
async def create_comment(req: CreateCommentRequest):
    import json as _json
    comment_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    r = _redis()
    await r.hset(f"comment:{comment_id}", mapping={
        "job_id": req.job_id,
        "author_name": req.author_name,
        "text": req.text,
        "timecode": str(req.timecode),
        "drawing": _json.dumps(req.drawing),
        "resolved": "0",
        "created_at": now,
    })
    await r.sadd(f"job:{req.job_id}:comments", comment_id)
    await r.aclose()
    return CommentInfo(
        id=comment_id, job_id=req.job_id,
        author_name=req.author_name, text=req.text,
        timecode=req.timecode, drawing=req.drawing,
        resolved=False, created_at=now,
    )


@app.get("/comments/{job_id}")
async def list_comments(job_id: str):
    import json as _json
    r = _redis()
    comment_ids = await r.smembers(f"job:{job_id}:comments")
    comments = []
    for cid_bytes in comment_ids:
        cid = cid_bytes.decode() if isinstance(cid_bytes, bytes) else cid_bytes
        data = await r.hgetall(f"comment:{cid}")
        if not data:
            continue
        drawing_raw = data.get(b"drawing", b"[]").decode()
        try:
            drawing = _json.loads(drawing_raw)
        except _json.JSONDecodeError:
            drawing = []
        comments.append(CommentInfo(
            id=cid,
            job_id=data.get(b"job_id", b"").decode(),
            author_name=data.get(b"author_name", b"").decode() or "Аноним",
            text=data.get(b"text", b"").decode(),
            timecode=float(data.get(b"timecode", b"0").decode()),
            drawing=drawing,
            resolved=data.get(b"resolved", b"0").decode() == "1",
            created_at=data.get(b"created_at", b"").decode(),
        ))
    await r.aclose()
    comments.sort(key=lambda c: c.timecode)
    return comments


@app.patch("/comments/{comment_id}")
async def update_comment(comment_id: str, req: UpdateCommentRequest):
    r = _redis()
    exists = await r.exists(f"comment:{comment_id}")
    if not exists:
        await r.aclose()
        raise HTTPException(status_code=404, detail="Comment not found")
    updates = {}
    if req.resolved is not None:
        updates["resolved"] = "1" if req.resolved else "0"
    if req.text is not None:
        updates["text"] = req.text
    if updates:
        await r.hset(f"comment:{comment_id}", mapping=updates)
    await r.aclose()
    return {"ok": True}


@app.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str):
    r = _redis()
    data = await r.hgetall(f"comment:{comment_id}")
    if not data:
        await r.aclose()
        raise HTTPException(status_code=404, detail="Comment not found")
    job_id = data.get(b"job_id", b"").decode()
    await r.delete(f"comment:{comment_id}")
    if job_id:
        await r.srem(f"job:{job_id}:comments", comment_id)
    await r.aclose()
    return {"ok": True}


@app.get("/health")
async def health():
    return {"status": "ok"}
