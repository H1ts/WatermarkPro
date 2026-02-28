import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Hls from 'hls.js';
import { FilePanelToggle, useFilePanel } from './FilePanel';

const API = '/api';

function WatermarkPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { files: libraryFiles, loading: libraryLoading } = useFilePanel();

  // File selection
  const [file, setFile] = useState(null);              // local File object (new upload)
  const [selectedFileId, setSelectedFileId] = useState(null); // existing file_id
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);

  // Watermark settings
  const [clientName, setClientName] = useState('');
  const [wmX, setWmX] = useState(50);
  const [wmY, setWmY] = useState(50);
  const [wmOpacity, setWmOpacity] = useState(30);
  const [wmFontSize, setWmFontSize] = useState(48);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [logoId, setLogoId] = useState(null);
  const [logoScale, setLogoScale] = useState(25);
  const [logoUploading, setLogoUploading] = useState(false);
  const [quality, setQuality] = useState('medium');
  const [codec, setCodec] = useState('mp4');

  // Processing state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileId, setFileId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [watchUrl, setWatchUrl] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);

  // Share
  const [shareEmail, setShareEmail] = useState('');
  const [shareStatus, setShareStatus] = useState(null);

  // UI
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [videoNativeWidth, setVideoNativeWidth] = useState(1920);

  const pollRef = useRef(null);
  const previewRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const draggingRef = useRef(false);
  const resultVideoRef = useRef(null);
  const resultHlsRef = useRef(null);

  // Auto-select file from URL param (?file_id=...)
  const fileIdFromUrl = searchParams.get('file_id');
  useEffect(() => {
    if (fileIdFromUrl && fileIdFromUrl !== selectedFileId) {
      setFile(null);
      setSelectedFileId(fileIdFromUrl);
      setFileId(fileIdFromUrl);
    }
  }, [fileIdFromUrl]); // depends only on URL param change

  // Video preview URL management
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (selectedFileId) {
      setVideoPreviewUrl(`${API}/files/${selectedFileId}/stream`);
      return;
    }
    setVideoPreviewUrl(null);
  }, [file, selectedFileId]);

  // Track preview container width
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPreviewWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [file, selectedFileId, jobId]);

  const hasFile = file || selectedFileId;

  const resetForm = () => {
    setFile(null);
    setSelectedFileId(null);
    setFileId(null);
    setJobId(null);
    setJobStatus(null);
    setJobProgress(0);
    setWatchUrl(null);
    setDownloadUrl(null);
    setError(null);
    setUploadProgress(0);
    setShareEmail('');
    setShareStatus(null);
  };

  const selectExistingFile = (f) => {
    resetForm();
    setSelectedFileId(f.file_id);
    setFileId(f.file_id);
  };

  // Logo handling
  const handleLogoSelect = async (e) => {
    const selected = e.target.files[0];
    if (!selected) return;
    if (selected.size > 5 * 1024 * 1024) { setError('Лого слишком большое (макс. 5 МБ)'); return; }
    if (!selected.type.startsWith('image/')) { setError('Выберите изображение (PNG, JPG, WebP)'); return; }
    setLogoFile(selected);
    setLogoPreviewUrl(URL.createObjectURL(selected));
    setLogoUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', selected);
      const res = await fetch(`${API}/upload-logo`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Logo upload failed');
      setLogoId(data.logo_id);
    } catch (err) {
      setError(err.message);
      setLogoFile(null);
      setLogoPreviewUrl(null);
    } finally { setLogoUploading(false); }
  };

  const removeLogo = () => {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    setLogoFile(null);
    setLogoPreviewUrl(null);
    setLogoId(null);
  };

  // Watermark position drag
  const updatePosition = useCallback((e) => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    setWmX(Math.round(x));
    setWmY(Math.round(y));
  }, []);

  const onPreviewMouseDown = useCallback((e) => {
    e.preventDefault();
    draggingRef.current = true;
    updatePosition(e);
  }, [updatePosition]);

  const onPreviewMouseMove = useCallback((e) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    updatePosition(e);
  }, [updatePosition]);

  const onPreviewMouseUp = useCallback(() => { draggingRef.current = false; }, []);

  useEffect(() => {
    const handleUp = () => { draggingRef.current = false; };
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchend', handleUp);
    return () => { window.removeEventListener('mouseup', handleUp); window.removeEventListener('touchend', handleUp); };
  }, []);

  // File drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type.startsWith('video/')) {
      resetForm();
      setFile(dropped);
    } else { setError('Перетащите видеофайл'); }
  }, []);

  const handleFileSelect = (e) => {
    const selected = e.target.files[0];
    if (selected) { resetForm(); setFile(selected); }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // Upload & process
  const upload = async () => {
    if (!hasFile || !clientName.trim()) {
      setError('Выберите файл и введите текст для ватермарка');
      return;
    }
    setError(null);

    let currentFileId = fileId;

    // If new file (not from library), upload first
    if (file && !selectedFileId) {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API}/upload`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        const result = await new Promise((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
            else reject(new Error(`Upload failed: ${xhr.statusText}`));
          };
          xhr.onerror = () => reject(new Error('Upload failed'));
          xhr.send(formData);
        });
        currentFileId = result.file_id;
        setFileId(result.file_id);
        setUploading(false);
      } catch (err) {
        setError(err.message);
        setUploading(false);
        return;
      }
    }

    // Process
    try {
      const procRes = await fetch(`${API}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: currentFileId,
          client_name: clientName.trim(),
          wm_x: wmX,
          wm_y: wmY,
          wm_opacity: wmOpacity,
          wm_font_size: wmFontSize,
          ...(logoId && { logo_id: logoId }),
          logo_scale: logoScale,
          quality,
          codec,
        }),
      });
      const procData = await procRes.json();
      if (!procRes.ok) throw new Error(procData.detail || 'Process request failed');
      setJobId(procData.job_id);
      setJobStatus('pending');
    } catch (err) {
      setError(err.message);
    }
  };

  // Poll job status
  useEffect(() => {
    if (!jobId || jobStatus === 'done' || jobStatus === 'error') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/status/${jobId}`);
        const data = await res.json();
        setJobStatus(data.status);
        setJobProgress(data.progress);
        if (data.status === 'done') {
          setWatchUrl(data.watch_url);
          setDownloadUrl(data.download_url);
          clearInterval(pollRef.current);
        }
        if (data.status === 'error') {
          setError(data.error || 'Processing failed');
          clearInterval(pollRef.current);
        }
      } catch { /* retry on next interval */ }
    }, 1000);
    return () => clearInterval(pollRef.current);
  }, [jobId, jobStatus]);

  // HLS player for result
  useEffect(() => {
    const video = resultVideoRef.current;
    if (!video || jobStatus !== 'done' || !jobId) return;
    const src = `/hls/${jobId}/index.m3u8`;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      resultHlsRef.current = hls;
      return () => { hls.destroy(); resultHlsRef.current = null; };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    }
  }, [jobId, jobStatus]);

  const isProcessing = jobStatus === 'pending' || jobStatus === 'processing';

  // Share by email (stub — just copy link)
  const handleShare = () => {
    if (!shareEmail.trim() || !watchUrl) return;
    // TODO: backend email sending
    navigator.clipboard.writeText(watchUrl);
    setShareStatus(`Ссылка скопирована. Отправьте на ${shareEmail.trim()}`);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-nav">
          <button className="btn-back" onClick={() => navigate('/')}>&#8592; Главная</button>
        </div>
        <h1 className="logo">Ватермарк</h1>
        <FilePanelToggle />
      </header>

      <div className="page-content">
            {/* ── Step 1: File selection ────────────────────────────────── */}
            {!jobId && !hasFile && (
              <div className="file-select-section">
                <h2 className="section-title">Выберите видео</h2>

                {libraryLoading && (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" /></div>
                )}

                {!libraryLoading && (
                  <div className="file-library-grid">
                    {/* Existing files */}
                    {libraryFiles.map((f) => (
                      <div
                        key={f.file_id}
                        className="file-library-card"
                        onClick={() => selectExistingFile(f)}
                      >
                        <div className="file-library-thumb">
                          <span className="file-library-icon">&#9654;</span>
                        </div>
                        <div className="file-library-info">
                          <span className="file-library-name">{f.filename}</span>
                          <span className="file-library-size">{formatSize(f.size)}</span>
                        </div>
                      </div>
                    ))}

                    {/* Upload new card */}
                    <div
                      className={`file-library-card file-library-card--upload ${dragOver ? 'file-library-card--drag' : ''}`}
                      onClick={() => document.getElementById('file-input').click()}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                    >
                      <div className="file-library-thumb file-library-thumb--upload">
                        <span className="file-library-icon">+</span>
                      </div>
                      <div className="file-library-info">
                        <span className="file-library-name">Загрузить новое</span>
                        <span className="file-library-size">или перетащите сюда</span>
                      </div>
                    </div>
                  </div>
                )}

                <input id="file-input" type="file" accept="video/*" onChange={handleFileSelect} hidden />
              </div>
            )}

            {/* ── Step 2: Watermark config ─────────────────────────────── */}
            {!jobId && hasFile && (
              <>
                {/* Video preview with watermark overlay */}
                <div
                  className={`video-dropzone ${dragOver ? 'video-dropzone--drag' : ''}`}
                  ref={previewRef}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onMouseDown={onPreviewMouseDown}
                  onMouseMove={onPreviewMouseMove}
                  onMouseUp={onPreviewMouseUp}
                  onTouchStart={onPreviewMouseDown}
                  onTouchMove={onPreviewMouseMove}
                  onTouchEnd={onPreviewMouseUp}
                >
                  {videoPreviewUrl && (
                    <>
                      <video
                        ref={videoPreviewRef}
                        src={videoPreviewUrl}
                        muted
                        preload="metadata"
                        playsInline
                        crossOrigin="anonymous"
                        style={{
                          position: 'absolute', top: 0, left: 0,
                          width: '100%', height: '100%',
                          objectFit: 'contain', pointerEvents: 'none',
                        }}
                        onLoadedData={(e) => {
                          e.target.currentTime = 0.5;
                          if (e.target.videoWidth > 0) setVideoNativeWidth(e.target.videoWidth);
                        }}
                      />

                      {/* Timecode */}
                      <span
                        className="wm-preview-timecode"
                        style={{
                          fontSize: `${Math.max(10, Math.round(36 * previewWidth / videoNativeWidth))}px`,
                          opacity: Math.max(0.35, Math.min((1 - wmOpacity / 100) + 0.4, 1)),
                        }}
                      >
                        00:00:00:00
                      </span>

                      {/* Watermark text + logo marker */}
                      {(clientName.trim() || (logoFile && logoPreviewUrl)) && (
                        <div className="wm-preview-marker" style={{ left: `${wmX}%`, top: `${wmY}%`, gap: '0px' }}>
                          {clientName.trim() && (
                            <span
                              className="wm-preview-text"
                              style={{
                                fontSize: `${Math.max(10, Math.round(wmFontSize * previewWidth / videoNativeWidth))}px`,
                                opacity: Math.max(0.3, 1 - wmOpacity / 100),
                              }}
                            >
                              {clientName.trim()}
                            </span>
                          )}
                          {logoFile && logoPreviewUrl && (
                            <img
                              src={logoPreviewUrl}
                              alt=""
                              className="wm-preview-logo"
                              style={{
                                width: `${Math.max(30, Math.round(previewWidth * logoScale / 100))}px`,
                                opacity: Math.max(0.3, 1 - wmOpacity / 100),
                              }}
                            />
                          )}
                        </div>
                      )}

                      {/* File info */}
                      <div
                        className="video-file-badge"
                        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); resetForm(); }}
                        title="Нажмите чтобы заменить"
                      >
                        &#9654; {file ? file.name : libraryFiles.find(f => f.file_id === selectedFileId)?.filename || 'video'}
                        {file && <> &middot; {formatSize(file.size)}</>}
                      </div>
                    </>
                  )}
                </div>

                {/* Settings panels */}
                <div className="settings-row">
                  <div className="settings-panel">
                    <h4 className="settings-panel-title">Ватермарк</h4>
                    <div className="form-group">
                      <label className="form-label">Текст для ватермарка</label>
                      <input
                        className="form-input"
                        type="text"
                        placeholder="Любой текст для наложения"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-row-item">
                        <label className="form-label">Прозрачность: {wmOpacity}%</label>
                        <input className="form-slider" type="range" min="20" max="80" value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} />
                      </div>
                      <div className="form-row-item">
                        <label className="form-label">Шрифт: {wmFontSize}px</label>
                        <input className="form-slider" type="range" min="16" max="120" value={wmFontSize} onChange={(e) => setWmFontSize(Number(e.target.value))} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Лого (PNG, JPG, WebP, до 5 МБ)</label>
                      {logoFile ? (
                        <div className="logo-preview">
                          <img src={logoPreviewUrl} alt="" className="logo-thumb" />
                          <span className="logo-name">{logoFile.name}</span>
                          <button type="button" className="logo-remove" onClick={removeLogo}>&#10005;</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="logo-upload-btn"
                          onClick={() => document.getElementById('logo-input').click()}
                          disabled={logoUploading}
                        >
                          {logoUploading ? 'Загрузка...' : 'Выбрать лого'}
                        </button>
                      )}
                      <input id="logo-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoSelect} hidden />
                    </div>
                    {logoFile && (
                      <div className="form-group">
                        <label className="form-label">Масштаб лого: {logoScale}%</label>
                        <input className="form-slider" type="range" min="10" max="50" value={logoScale} onChange={(e) => setLogoScale(Number(e.target.value))} />
                      </div>
                    )}
                  </div>

                  <div className="settings-panel">
                    <h4 className="settings-panel-title">Настройки вывода</h4>
                    <div className="form-group">
                      <label className="form-label">Качество</label>
                      <select className="form-select" value={quality} onChange={(e) => setQuality(e.target.value)}>
                        <option value="low">Низкое (быстро)</option>
                        <option value="medium">Среднее</option>
                        <option value="high">Лучшее (медленно)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Формат</label>
                      <select className="form-select" value={codec} onChange={(e) => setCodec(e.target.value)}>
                        <option value="mp4">MP4</option>
                        <option value="mov">MOV</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  className="btn-primary"
                  onClick={upload}
                  disabled={!hasFile || !clientName.trim() || uploading}
                >
                  {uploading ? `Загрузка... ${uploadProgress}%` : 'Обработать'}
                </button>

                {uploading && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </>
            )}

            {/* ── Step 3: Processing ───────────────────────────────────── */}
            {isProcessing && (
              <div className="processing">
                <div className="spinner" />
                <h2>Обработка видео...</h2>
                <p className="status-text">{jobStatus === 'pending' ? 'В очереди' : 'Кодирование'}</p>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${jobProgress}%` }} />
                </div>
                <p className="progress-text">{jobProgress}%</p>
              </div>
            )}

            {/* ── Step 4: Result + Share ───────────────────────────────── */}
            {jobStatus === 'done' && watchUrl && (
              <div className="result-player">
                <div className="result-video-wrap">
                  <video
                    ref={resultVideoRef}
                    className="result-video"
                    controls
                    playsInline
                    autoPlay
                    onContextMenu={(e) => e.preventDefault()}
                  />
                </div>

                <div className="result-bar">
                  <div className="result-actions">
                    <a href={`/review/${jobId}`} className="btn-watch">Рецензировать</a>
                    {downloadUrl && (
                      <a href={downloadUrl} download className="btn-download">Скачать {codec.toUpperCase()}</a>
                    )}
                    <button className="btn-secondary" onClick={resetForm}>Загрузить ещё</button>
                  </div>
                  <div className="link-box">
                    <input readOnly value={watchUrl} onClick={(e) => e.target.select()} />
                    <button onClick={() => navigator.clipboard.writeText(watchUrl)}>Копировать</button>
                  </div>

                  {/* Share by email */}
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
                      <button
                        className="share-btn"
                        onClick={handleShare}
                        disabled={!shareEmail.trim()}
                      >
                        Отправить
                      </button>
                    </div>
                    {shareStatus && <p className="share-status">{shareStatus}</p>}
                  </div>
                </div>
              </div>
            )}

        {/* Error */}
        {error && (
          <div className="error">
            <p>{error}</p>
            <button onClick={() => setError(null)}>Закрыть</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default WatermarkPage;
