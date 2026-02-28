import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
import { FilePanelToggle, useFilePanel } from './FilePanel';

const API = '/api';

function ComparePage() {
  const navigate = useNavigate();

  // Selection
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [step, setStep] = useState('select'); // 'select' | 'compare'
  const [mode, setMode] = useState('side');   // 'side' | 'ab'

  // Player
  const videoARef = useRef(null);
  const videoBRef = useRef(null);
  const hlsARef = useRef(null);
  const hlsBRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [abActive, setAbActive] = useState('a'); // for A/B mode

  // Share
  const [shareEmail, setShareEmail] = useState('');
  const [shareStatus, setShareStatus] = useState(null);

  // Fetch completed jobs
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/jobs/all`);
        const data = await res.json();
        setJobs(data);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const toggleSelect = (job) => {
    if (selectedA?.id === job.id) { setSelectedA(null); return; }
    if (selectedB?.id === job.id) { setSelectedB(null); return; }
    if (!selectedA) { setSelectedA(job); return; }
    if (!selectedB) { setSelectedB(job); return; }
    // Both slots filled — replace B
    setSelectedB(job);
  };

  const startCompare = () => {
    if (selectedA && selectedB) setStep('compare');
  };

  // Setup HLS players
  useEffect(() => {
    if (step !== 'compare') return;

    const setup = (videoEl, hlsRef, jobId) => {
      if (!videoEl) return;
      const src = `/hls/${jobId}/index.m3u8`;
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(videoEl);
        hlsRef.current = hls;
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = src;
      }
    };

    setup(videoARef.current, hlsARef, selectedA.id);
    setup(videoBRef.current, hlsBRef, selectedB.id);

    return () => {
      if (hlsARef.current) { hlsARef.current.destroy(); hlsARef.current = null; }
      if (hlsBRef.current) { hlsBRef.current.destroy(); hlsBRef.current = null; }
    };
  }, [step, selectedA, selectedB]);

  // Sync play/pause
  const togglePlay = useCallback(() => {
    const a = videoARef.current;
    const b = videoBRef.current;
    if (!a || !b) return;
    if (playing) {
      a.pause();
      b.pause();
    } else {
      a.play();
      b.play();
    }
    setPlaying(!playing);
  }, [playing]);

  // Time update from A
  useEffect(() => {
    const a = videoARef.current;
    if (!a) return;
    const onTime = () => {
      setCurrentTime(a.currentTime);
      if (a.duration) setDuration(a.duration);
    };
    const onEnded = () => setPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnded);
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnded); };
  }, [step]);

  // Seek both
  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = frac * duration;
    if (videoARef.current) videoARef.current.currentTime = time;
    if (videoBRef.current) videoBRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Share
  const handleShare = () => {
    if (!shareEmail.trim() || !selectedA || !selectedB) return;
    const url = `${window.location.origin}/compare?a=${selectedA.id}&b=${selectedB.id}`;
    navigator.clipboard.writeText(url);
    setShareStatus(`Ссылка скопирована. Отправьте на ${shareEmail.trim()}`);
  };

  const { open: openFilePanel } = useFilePanel();
  const isSelected = (job) => selectedA?.id === job.id || selectedB?.id === job.id;

  return (
    <div className="app">
      <header className="header">
        <div className="header-nav">
          <button className="btn-back" onClick={() => step === 'compare' ? setStep('select') : navigate('/')}>
            &#8592; {step === 'compare' ? 'Выбор' : 'Главная'}
          </button>
        </div>
        <h1 className="logo">Сравнение версий</h1>
        <FilePanelToggle />
        {step === 'compare' && (
          <div className="compare-mode-toggle">
            <button
              className={`compare-mode-btn ${mode === 'side' ? 'compare-mode-btn--active' : ''}`}
              onClick={() => setMode('side')}
            >
              Side-by-side
            </button>
            <button
              className={`compare-mode-btn ${mode === 'ab' ? 'compare-mode-btn--active' : ''}`}
              onClick={() => setMode('ab')}
            >
              A/B
            </button>
          </div>
        )}
      </header>

      {/* ── Selection step ─────────────────────────────────────────── */}
      {step === 'select' && (
        <div className="page-content">
          <h2 className="section-title">Выберите 2 видео для сравнения</h2>

          {selectedA && selectedB && (
            <div className="compare-selection-bar">
              <span className="compare-sel-label">A: {selectedA.filename}</span>
              <span className="compare-sel-label">B: {selectedB.filename}</span>
              <button className="btn-primary" style={{ width: 'auto', marginTop: 0, padding: '10px 24px' }} onClick={startCompare}>
                Сравнить
              </button>
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" /></div>
          )}

          {!loading && jobs.length < 2 && (
            <div className="empty-state">
              <p>Недостаточно обработанных видео</p>
              <p className="empty-state-sub">Для сравнения нужно минимум 2 обработанных видео</p>
              <button className="btn-primary" style={{ width: 'auto', padding: '10px 24px', marginTop: 16 }} onClick={openFilePanel}>
                Загрузить видео
              </button>
            </div>
          )}

          {!loading && jobs.length >= 2 && (
            <div className="file-library-grid">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className={`file-library-card ${isSelected(job) ? 'file-library-card--selected' : ''}`}
                  onClick={() => toggleSelect(job)}
                >
                  <div className="file-library-thumb">
                    <span className="file-library-icon">&#9654;</span>
                    {isSelected(job) && (
                      <span className="file-library-badge">
                        {selectedA?.id === job.id ? 'A' : 'B'}
                      </span>
                    )}
                  </div>
                  <div className="file-library-info">
                    <span className="file-library-name">{job.filename || 'video'}</span>
                    <span className="file-library-size">{job.client_name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Compare step ───────────────────────────────────────────── */}
      {step === 'compare' && (
        <div className="compare-layout">
          {/* Side-by-side mode */}
          {mode === 'side' && (
            <div className="compare-side">
              <div className="compare-player">
                <div className="compare-player-label">A: {selectedA.filename}</div>
                <div className="compare-video-wrap">
                  <video
                    ref={videoARef}
                    className="compare-video"
                    playsInline
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
              </div>
              <div className="compare-player">
                <div className="compare-player-label">B: {selectedB.filename}</div>
                <div className="compare-video-wrap">
                  <video
                    ref={videoBRef}
                    className="compare-video"
                    playsInline
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>
              </div>
            </div>
          )}

          {/* A/B overlay mode */}
          {mode === 'ab' && (
            <div className="compare-ab">
              <div className="compare-ab-wrap">
                <video
                  ref={videoARef}
                  className="compare-video"
                  playsInline
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ display: abActive === 'a' ? 'block' : 'none' }}
                />
                <video
                  ref={videoBRef}
                  className="compare-video"
                  playsInline
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ display: abActive === 'b' ? 'block' : 'none' }}
                />
              </div>
              <div className="compare-ab-toggle">
                <button
                  className={`compare-ab-btn ${abActive === 'a' ? 'compare-ab-btn--active' : ''}`}
                  onClick={() => setAbActive('a')}
                >
                  A: {selectedA.filename}
                </button>
                <button
                  className={`compare-ab-btn ${abActive === 'b' ? 'compare-ab-btn--active' : ''}`}
                  onClick={() => setAbActive('b')}
                >
                  B: {selectedB.filename}
                </button>
              </div>
            </div>
          )}

          {/* Shared controls */}
          <div className="compare-controls">
            <button className="compare-play-btn" onClick={togglePlay}>
              {playing ? '\u275A\u275A' : '\u25B6'}
            </button>
            <span className="compare-time">{formatTime(currentTime)}</span>
            <div className="compare-timeline" onClick={handleSeek}>
              <div className="compare-timeline-fill" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
            </div>
            <span className="compare-time">{formatTime(duration)}</span>
          </div>

          {/* Share */}
          <div className="share-section">
            <h4 className="share-title">Поделиться по email</h4>
            <div className="share-row">
              <input
                className="share-input"
                type="email"
                placeholder="email@example.com"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
              />
              <button className="share-btn" onClick={handleShare} disabled={!shareEmail.trim()}>
                Отправить
              </button>
            </div>
            {shareStatus && <p className="share-status">{shareStatus}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default ComparePage;
