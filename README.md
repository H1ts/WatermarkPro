# WatermarkPro

Video watermark & secure HLS streaming platform for film production.

## Quick Start

```bash
docker compose up --build
```

Open http://localhost in your browser.

## Architecture

```
Browser (React SPA)
  → Nginx (reverse proxy)
    → FastAPI (upload, process, status)
      → FFmpeg (watermark + timecode → MP4 + HLS)
    → HLS segments (static via Nginx)
```

## Services

| Service  | Port | Description                         |
|----------|------|-------------------------------------|
| nginx    | 80   | Reverse proxy, HLS segment serving  |
| api      | 8000 | FastAPI backend                     |
| frontend | —    | React SPA (served via nginx)        |
| redis    | 6379 | Job metadata & status storage       |

## API Endpoints

- `POST /upload` — upload a video file (multipart)
- `POST /process` — start watermark processing `{ file_id, client_name }`
- `GET /status/{job_id}` — poll render progress
- `GET /watch/{job_id}` — HLS player page

## FFmpeg Pipeline

1. Text watermark (client name) — centered, semi-transparent
2. Burn-in timecode — bottom center
3. H.264 ultrafast encode → MP4
4. HLS segmentation (copy codec) → .m3u8 + .ts
