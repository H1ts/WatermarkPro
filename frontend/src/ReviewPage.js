import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Hls from 'hls.js';

const API = '/api';

const TOOLS = [
  { id: 'freehand', label: '\u270F', title: 'Карандаш' },
  { id: 'arrow', label: '\u2192', title: 'Стрелка' },
  { id: 'circle', label: '\u25CB', title: 'Круг' },
  { id: 'rect', label: '\u25A1', title: 'Прямоугольник' },
];

const COLORS = ['#ff3b3b', '#ffb800', '#00d26a', '#0096ff', '#ffffff'];

function formatTC(seconds, fps = 25) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return (
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + ':' +
    String(f).padStart(2, '0')
  );
}

/* ── Drawing helpers ─────────────────────────────────────────────── */

function renderStrokes(ctx, list, w, h) {
  for (const s of list) {
    ctx.strokeStyle = s.color || '#ff3b3b';
    ctx.lineWidth = (s.width || 3) * (w / 960);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (s.type === 'freehand' && s.points && s.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(s.points[0][0] * w, s.points[0][1] * h);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i][0] * w, s.points[i][1] * h);
      }
      ctx.stroke();
    }

    if (s.type === 'arrow' && s.from && s.to) {
      const fx = s.from[0] * w, fy = s.from[1] * h;
      const tx = s.to[0] * w, ty = s.to[1] * h;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const angle = Math.atan2(ty - fy, tx - fx);
      const hl = 14 * (w / 960);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - hl * Math.cos(angle - Math.PI / 6), ty - hl * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - hl * Math.cos(angle + Math.PI / 6), ty - hl * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    if (s.type === 'circle' && s.center && s.radius != null) {
      ctx.beginPath();
      ctx.ellipse(
        s.center[0] * w, s.center[1] * h,
        Math.abs(s.radius) * w, Math.abs(s.radius) * h,
        0, 0, Math.PI * 2,
      );
      ctx.stroke();
    }

    if (s.type === 'rect' && s.from && s.to) {
      const x1 = s.from[0] * w, y1 = s.from[1] * h;
      const x2 = s.to[0] * w, y2 = s.to[1] * h;
      ctx.strokeRect(
        Math.min(x1, x2), Math.min(y1, y2),
        Math.abs(x2 - x1), Math.abs(y2 - y1),
      );
    }
  }
}

/* ── Component ───────────────────────────────────────────────────── */

function ReviewPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();

  // Job info
  const [jobInfo, setJobInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  // Video
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Canvas
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Drawing
  const [tool, setTool] = useState(null);
  const [color, setColor] = useState('#ff3b3b');
  const [strokes, setStrokes] = useState([]);
  const [tempStroke, setTempStroke] = useState(null);
  const drawingRef = useRef(false);
  const startRef = useRef(null);

  // Comments
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [authorName, setAuthorName] = useState(() => localStorage.getItem('wmpro_author') || '');
  const [activeComment, setActiveComment] = useState(null);
  const [showForm, setShowForm] = useState(false);

  /* ── Fetch job ─────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/status/${jobId}`);
        if (!res.ok) throw new Error();
        setJobInfo(await res.json());
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [jobId]);

  /* ── Fetch comments ────────────────────────────────────────────── */
  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`${API}/comments/${jobId}`);
      if (res.ok) setComments(await res.json());
    } catch { /* ignore */ }
  }, [jobId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  /* ── HLS setup ─────────────────────────────────────────────────── */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !jobInfo || jobInfo.status !== 'done') return;

    const src = `/hls/${jobId}/index.m3u8`;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Duration available after manifest is parsed
        setTimeout(() => {
          if (video.duration && isFinite(video.duration)) {
            setDuration(video.duration);
          }
        }, 200);
      });
      hlsRef.current = hls;
      return () => { hls.destroy(); hlsRef.current = null; };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    }
  }, [jobId, jobInfo]);

  /* ── Video events ──────────────────────────────────────────────── */
  // NOTE: depends on [jobInfo] because <video> is conditionally rendered
  // only after jobInfo loads — with [] the effect runs when video is null
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      if (v.duration && isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
      }
    };
    const onDur = () => {
      if (v.duration && isFinite(v.duration)) setDuration(v.duration);
    };
    const onPlay = () => { setPaused(false); setActiveComment(null); };
    const onPause = () => setPaused(true);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('loadedmetadata', onDur);
    v.addEventListener('loadeddata', onDur);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('loadedmetadata', onDur);
      v.removeEventListener('loadeddata', onDur);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [jobInfo]);

  /* ── Canvas resize ─────────────────────────────────────────────── */
  useEffect(() => {
    const wrap = wrapRef.current;
    const v = videoRef.current;
    if (!wrap || !v) return;
    const sync = () => {
      setCanvasSize({ w: v.clientWidth, h: v.clientHeight });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    // Also sync when video metadata loads (dimensions become known)
    v.addEventListener('loadeddata', sync);
    return () => {
      ro.disconnect();
      v.removeEventListener('loadeddata', sync);
    };
  }, [loading, jobInfo]);

  /* ── Render canvas ─────────────────────────────────────────────── */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);

    const toRender = activeComment ? (activeComment.drawing || []) : strokes;
    renderStrokes(ctx, toRender, c.width, c.height);
    if (tempStroke) renderStrokes(ctx, [tempStroke], c.width, c.height);
  }, [strokes, tempStroke, activeComment, canvasSize]);

  /* ── Drawing handlers ──────────────────────────────────────────── */
  const getPos = useCallback((e) => {
    const c = canvasRef.current;
    if (!c) return [0, 0];
    const rect = c.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return [(cx - rect.left) / rect.width, (cy - rect.top) / rect.height];
  }, []);

  const onDrawStart = useCallback((e) => {
    if (!tool || !paused) return;
    e.preventDefault();
    drawingRef.current = true;
    const pos = getPos(e);
    startRef.current = pos;
    if (tool === 'freehand') {
      setTempStroke({ type: 'freehand', points: [pos], color, width: 3 });
    }
  }, [tool, paused, color, getPos]);

  const onDrawMove = useCallback((e) => {
    if (!drawingRef.current || !tool) return;
    e.preventDefault();
    const pos = getPos(e);
    if (tool === 'freehand') {
      setTempStroke(p => p ? { ...p, points: [...p.points, pos] } : null);
    } else if (tool === 'arrow') {
      setTempStroke({ type: 'arrow', from: startRef.current, to: pos, color, width: 3 });
    } else if (tool === 'circle') {
      const s = startRef.current;
      setTempStroke({ type: 'circle', center: s, radius: Math.hypot(pos[0] - s[0], pos[1] - s[1]), color, width: 3 });
    } else if (tool === 'rect') {
      setTempStroke({ type: 'rect', from: startRef.current, to: pos, color, width: 3 });
    }
  }, [tool, color, getPos]);

  const onDrawEnd = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (tempStroke) {
      setStrokes(p => [...p, tempStroke]);
      setTempStroke(null);
      setShowForm(true);
    }
  }, [tempStroke]);

  useEffect(() => {
    const up = () => { if (drawingRef.current) onDrawEnd(); };
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
  }, [onDrawEnd]);

  /* ── Undo last stroke ──────────────────────────────────────────── */
  const undoStroke = () => setStrokes(p => p.slice(0, -1));

  /* ── Submit comment ────────────────────────────────────────────── */
  const submitComment = async () => {
    if (!commentText.trim() && strokes.length === 0) return;
    const name = authorName.trim() || 'Аноним';
    localStorage.setItem('wmpro_author', name);
    try {
      const res = await fetch(`${API}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          author_name: name,
          text: commentText.trim(),
          timecode: currentTime,
          drawing: strokes,
        }),
      });
      if (res.ok) {
        setCommentText('');
        setStrokes([]);
        setShowForm(false);
        setTool(null);
        fetchComments();
      }
    } catch { /* ignore */ }
  };

  /* ── Click comment → seek ──────────────────────────────────────── */
  const seekTo = (comment) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = comment.timecode;
      v.pause();
    }
    setActiveComment(comment);
    setStrokes([]);
    setShowForm(false);
    setTool(null);
  };

  /* ── Resolve / Delete ──────────────────────────────────────────── */
  const toggleResolve = async (c) => {
    await fetch(`${API}/comments/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: !c.resolved }),
    });
    fetchComments();
  };

  const deleteComment = async (id) => {
    await fetch(`${API}/comments/${id}`, { method: 'DELETE' });
    if (activeComment?.id === id) setActiveComment(null);
    fetchComments();
  };

  /* ── Start new comment (pause video, enable tools) ─────────────── */
  const startAnnotation = () => {
    const v = videoRef.current;
    if (v) v.pause();
    setActiveComment(null);
    setStrokes([]);
    setTool('freehand');
    setShowForm(true);
  };

  /* ── Cancel annotation ─────────────────────────────────────────── */
  const cancelAnnotation = () => {
    setStrokes([]);
    setTempStroke(null);
    setTool(null);
    setShowForm(false);
    setCommentText('');
  };

  /* ── Keyboard: Escape, Space ───────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') cancelAnnotation();
      if (e.key === ' ') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) v.paused ? v.play() : v.pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Comment markers on timeline ───────────────────────────────── */
  const commentMarkers = duration > 0
    ? comments.map(c => ({ ...c, pct: (c.timecode / duration) * 100 }))
    : [];

  /* ── Render ────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="app">
        <div className="review-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (!jobInfo || jobInfo.status !== 'done') {
    return (
      <div className="app">
        <div className="review-loading">
          <p>Видео не найдено или ещё обрабатывается</p>
          <button className="btn-new" onClick={() => navigate(-1)}>Назад</button>
        </div>
      </div>
    );
  }

  const drawActive = paused && tool != null;
  const fps = jobInfo.fps || 25;

  return (
    <div className="review-page">
      {/* Header */}
      <header className="review-header">
        <button className="btn-back" onClick={() => navigate(-1)}>&#8592; Назад</button>
        <h1 className="review-title">{jobInfo.filename || 'Video'}</h1>
        <span className="review-client">{jobInfo.client_name}</span>
      </header>

      <div className="review-body">
        {/* ── Left: Video + tools ────────────────────────────────── */}
        <div className="review-video-area">
          <div className="review-player-wrap" ref={wrapRef}>
            <video
              ref={videoRef}
              className="review-video"
              playsInline
              onClick={(e) => {
                if (drawActive) return;
                const v = videoRef.current;
                if (v) v.paused ? v.play() : v.pause();
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
            <canvas
              ref={canvasRef}
              className="review-canvas"
              width={canvasSize.w}
              height={canvasSize.h}
              style={{
                width: canvasSize.w,
                height: canvasSize.h,
                pointerEvents: drawActive ? 'auto' : 'none',
                cursor: drawActive ? 'crosshair' : 'default',
              }}
              onMouseDown={onDrawStart}
              onMouseMove={onDrawMove}
              onMouseUp={onDrawEnd}
              onTouchStart={onDrawStart}
              onTouchMove={onDrawMove}
              onTouchEnd={onDrawEnd}
            />
          </div>

          {/* Timeline with markers */}
          <div className="review-timeline">
            <span className="review-tc">{formatTC(currentTime, fps)}</span>
            <div
              className="review-timeline-bar"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                if (videoRef.current) videoRef.current.currentTime = pct * duration;
              }}
            >
              <div className="review-timeline-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
              {commentMarkers.map((c) => (
                <div
                  key={c.id}
                  className={`review-timeline-marker ${c.resolved ? 'marker-resolved' : ''}`}
                  style={{ left: `${c.pct}%` }}
                  title={`${formatTC(c.timecode, fps)} — ${c.author_name}: ${c.text}`}
                  onClick={(e) => { e.stopPropagation(); seekTo(c); }}
                />
              ))}
            </div>
            <span className="review-tc">{formatTC(duration, fps)}</span>
          </div>

          {/* Toolbar */}
          <div className="review-toolbar">
            <div className="review-toolbar-left">
              <button
                className="review-btn-annotate"
                onClick={startAnnotation}
                disabled={drawActive}
              >
                + Комментарий
              </button>

              {drawActive && (
                <>
                  <div className="review-tools">
                    {TOOLS.map(t => (
                      <button
                        key={t.id}
                        className={`review-tool-btn ${tool === t.id ? 'review-tool-btn--active' : ''}`}
                        onClick={() => setTool(t.id)}
                        title={t.title}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="review-colors">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        className={`review-color-btn ${color === c ? 'review-color-btn--active' : ''}`}
                        style={{ background: c }}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                  {strokes.length > 0 && (
                    <button className="review-undo-btn" onClick={undoStroke} title="Отменить">&#8630;</button>
                  )}
                </>
              )}
            </div>

            <div className="review-toolbar-right">
              {drawActive && (
                <button className="review-cancel-btn" onClick={cancelAnnotation}>Отмена</button>
              )}
            </div>
          </div>

          {/* Inline comment form */}
          {showForm && paused && (
            <div className="review-comment-form">
              <div className="review-form-row">
                <input
                  className="review-input review-author-input"
                  placeholder="Ваше имя"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                />
              </div>
              <div className="review-form-row">
                <textarea
                  className="review-input review-textarea"
                  placeholder="Напишите комментарий..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={2}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment();
                  }}
                />
              </div>
              <div className="review-form-actions">
                <span className="review-form-tc">&#9200; {formatTC(currentTime, fps)}</span>
                <div className="review-form-buttons">
                  <button className="review-cancel-btn" onClick={cancelAnnotation}>Отмена</button>
                  <button
                    className="review-submit-btn"
                    onClick={submitComment}
                    disabled={!commentText.trim() && strokes.length === 0}
                  >
                    Отправить
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Comments panel ──────────────────────────────── */}
        <div className="review-comments-panel">
          <div className="review-comments-header">
            <h2>Комментарии <span className="review-comments-count">{comments.length}</span></h2>
          </div>

          {comments.length === 0 ? (
            <div className="review-comments-empty">
              <p>Нет комментариев</p>
              <p className="review-comments-hint">Поставьте видео на паузу и нажмите «+ Комментарий»</p>
            </div>
          ) : (
            <div className="review-comments-list">
              {comments.map(c => (
                <div
                  key={c.id}
                  className={`review-comment-card ${activeComment?.id === c.id ? 'review-comment-card--active' : ''} ${c.resolved ? 'review-comment-card--resolved' : ''}`}
                  onClick={() => seekTo(c)}
                >
                  <div className="review-comment-top">
                    <span className="review-comment-tc" onClick={(e) => { e.stopPropagation(); seekTo(c); }}>
                      {formatTC(c.timecode, fps)}
                    </span>
                    <span className="review-comment-author">{c.author_name}</span>
                    {c.drawing && c.drawing.length > 0 && (
                      <span className="review-comment-draw-badge" title="С рисунком">&#9998;</span>
                    )}
                  </div>
                  <p className="review-comment-text">{c.text}</p>
                  <div className="review-comment-actions">
                    <button
                      className={`review-resolve-btn ${c.resolved ? 'review-resolve-btn--done' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleResolve(c); }}
                    >
                      {c.resolved ? '\u2713 Решено' : 'Решить'}
                    </button>
                    <button
                      className="review-delete-btn"
                      onClick={(e) => { e.stopPropagation(); deleteComment(c.id); }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReviewPage;
