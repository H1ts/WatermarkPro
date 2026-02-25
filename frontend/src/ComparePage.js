import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Hls from 'hls.js';

const API = '/api';

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

/* ── Один HLS-плеер ──────────────────────────────────────────────── */

function ComparePlayer({ jobId, label, videoRef, onTimeUpdate, onDuration, onPlayPause }) {
  const hlsRef = useRef(null);
  const tokenRef = useRef('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !jobId) return;

    let destroyed = false;

    (async () => {
      // Получаем HLS-токен
      try {
        const res = await fetch(`${API}/hls-token/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          tokenRef.current = data.token;
        }
      } catch { /* ignore */ }

      if (destroyed) return;
      const token = tokenRef.current;
      const src = `/hls/${jobId}/index.m3u8?token=${token}`;

      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup: (xhr, url) => {
            const sep = url.includes('?') ? '&' : '?';
            xhr.open('GET', `${url}${sep}token=${tokenRef.current}`, true);
          },
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
      }
    })();

    return () => {
      destroyed = true;
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [jobId, videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => onTimeUpdate?.(v.currentTime);
    const onDur = () => {
      if (v.duration && isFinite(v.duration)) onDuration?.(v.duration);
    };
    const onPlay = () => onPlayPause?.(false);
    const onPause = () => onPlayPause?.(true);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('loadedmetadata', onDur);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('loadedmetadata', onDur);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [videoRef, onTimeUpdate, onDuration, onPlayPause]);

  return (
    <div className="compare-player">
      <div className="compare-player-label">{label}</div>
      <div className="compare-player-wrap">
        <video
          ref={videoRef}
          className="compare-video"
          playsInline
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}

/* ── Страница сравнения ──────────────────────────────────────────── */

function ComparePage() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [versions, setVersions] = useState([]);
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Общий таймлайн
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);

  const leftVideoRef = useRef(null);
  const rightVideoRef = useRef(null);
  const syncingRef = useRef(false);

  /* ── Загрузка версий ─────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/versions/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          const done = data.filter(v => v.status === 'done');
          setVersions(done);
          if (done.length >= 2) {
            const leftParam = searchParams.get('left');
            const rightParam = searchParams.get('right');
            setLeftId(leftParam && done.find(v => v.job_id === leftParam) ? leftParam : done[0].job_id);
            setRightId(rightParam && done.find(v => v.job_id === rightParam) ? rightParam : done[done.length - 1].job_id);
          }
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [jobId, searchParams]);

  /* ── Синхронизация play/pause ────────────────────────────────── */
  const syncPlay = useCallback(() => {
    const left = leftVideoRef.current;
    const right = rightVideoRef.current;
    if (!left || !right) return;
    left.play().catch(() => {});
    right.play().catch(() => {});
  }, []);

  const syncPause = useCallback(() => {
    const left = leftVideoRef.current;
    const right = rightVideoRef.current;
    if (left) left.pause();
    if (right) right.pause();
  }, []);

  const togglePlayPause = useCallback(() => {
    if (paused) syncPlay();
    else syncPause();
  }, [paused, syncPlay, syncPause]);

  /* ── Синхронизация seek ──────────────────────────────────────── */
  const syncSeek = useCallback((time) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const left = leftVideoRef.current;
    const right = rightVideoRef.current;
    if (left) left.currentTime = time;
    if (right) right.currentTime = time;
    setCurrentTime(time);
    setTimeout(() => { syncingRef.current = false; }, 50);
  }, []);

  const onLeftTime = useCallback((t) => {
    if (!syncingRef.current) setCurrentTime(t);
  }, []);

  const onLeftDuration = useCallback((d) => {
    setDuration(prev => Math.max(prev, d));
  }, []);

  const onRightDuration = useCallback((d) => {
    setDuration(prev => Math.max(prev, d));
  }, []);

  const onLeftPlayPause = useCallback((isPaused) => {
    setPaused(isPaused);
    const right = rightVideoRef.current;
    if (!right) return;
    if (isPaused) right.pause();
    else right.play().catch(() => {});
  }, []);

  /* ── Клавиатура ──────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlayPause();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        syncSeek(Math.max(0, currentTime - 5));
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        syncSeek(Math.min(duration, currentTime + 5));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlayPause, syncSeek, currentTime, duration]);

  /* ── Рендер ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="app">
        <div className="review-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (versions.length < 2) {
    return (
      <div className="app">
        <div className="review-loading">
          <p>Недостаточно версий для сравнения</p>
          <button className="btn-new" onClick={() => navigate(-1)}>Назад</button>
        </div>
      </div>
    );
  }

  return (
    <div className="compare-page">
      {/* Header */}
      <header className="compare-header">
        <button className="btn-back" onClick={() => navigate(-1)}>&#8592; Назад</button>
        <h1 className="compare-title">Сравнение версий</h1>

        <div className="compare-selectors">
          <select
            className="compare-select"
            value={leftId || ''}
            onChange={(e) => setLeftId(e.target.value)}
          >
            {versions.map(v => (
              <option key={v.job_id} value={v.job_id}>V{v.version}{v.filename ? ` — ${v.filename}` : ''}</option>
            ))}
          </select>
          <span className="compare-vs">vs</span>
          <select
            className="compare-select"
            value={rightId || ''}
            onChange={(e) => setRightId(e.target.value)}
          >
            {versions.map(v => (
              <option key={v.job_id} value={v.job_id}>V{v.version}{v.filename ? ` — ${v.filename}` : ''}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Два плеера */}
      <div className="compare-body">
        <ComparePlayer
          jobId={leftId}
          label={`V${versions.find(v => v.job_id === leftId)?.version || '?'}`}
          videoRef={leftVideoRef}
          onTimeUpdate={onLeftTime}
          onDuration={onLeftDuration}
          onPlayPause={onLeftPlayPause}
        />
        <ComparePlayer
          jobId={rightId}
          label={`V${versions.find(v => v.job_id === rightId)?.version || '?'}`}
          videoRef={rightVideoRef}
          onDuration={onRightDuration}
        />
      </div>

      {/* Общий таймлайн */}
      <div className="compare-timeline">
        <button className="compare-play-btn" onClick={togglePlayPause}>
          {paused ? '\u25B6' : '\u23F8'}
        </button>
        <span className="compare-tc">{formatTC(currentTime)}</span>
        <div
          className="compare-timeline-bar"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            syncSeek(pct * duration);
          }}
        >
          <div
            className="compare-timeline-fill"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
        <span className="compare-tc">{formatTC(duration)}</span>
      </div>
    </div>
  );
}

export default ComparePage;
