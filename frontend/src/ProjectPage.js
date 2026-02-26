import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const API = '/api';

function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  // Project data
  const [project, setProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);

  // Upload & process state
  const [file, setFile] = useState(null);
  const [clientName, setClientName] = useState('');
  const [notifyEmail, setNotifyEmail] = useState('');
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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileId, setFileId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [watchUrl, setWatchUrl] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const pollRef = useRef(null);
  const previewRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const draggingRef = useRef(false);
  const [previewWidth, setPreviewWidth] = useState(0);

  // Fetch project data
  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`${API}/projects/${projectId}`);
      if (!res.ok) throw new Error('Проект не найден');
      const data = await res.json();
      setProject(data);
    } catch {
      setError('Не удалось загрузить проект');
    } finally {
      setProjectLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Create video preview blob URL when file changes
  useEffect(() => {
    if (!file) {
      setVideoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Track preview container width
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPreviewWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [projectLoading, jobId]);

  const resetForm = () => {
    setFile(null);
    setFileId(null);
    setJobId(null);
    setJobStatus(null);
    setJobProgress(0);
    setWatchUrl(null);
    setDownloadUrl(null);
    setError(null);
    setUploadProgress(0);
  };

  const handleLogoSelect = async (e) => {
    const selected = e.target.files[0];
    if (!selected) return;
    if (selected.size > 5 * 1024 * 1024) {
      setError('Лого слишком большое (макс. 5 МБ)');
      return;
    }
    if (!selected.type.startsWith('image/')) {
      setError('Выберите изображение (PNG, JPG, WebP)');
      return;
    }
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
    } finally {
      setLogoUploading(false);
    }
  };

  const removeLogo = () => {
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    setLogoFile(null);
    setLogoPreviewUrl(null);
    setLogoId(null);
  };

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

  const onPreviewMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  useEffect(() => {
    const handleUp = () => { draggingRef.current = false; };
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchend', handleUp);
    };
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type.startsWith('video/')) {
      resetForm();
      setFile(dropped);
    } else {
      setError('Перетащите видеофайл');
    }
  }, []);

  const handleFileSelect = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      resetForm();
      setFile(selected);
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const upload = async () => {
    if (!file || !clientName.trim()) {
      setError('Выберите файл и введите текст для ватермарка');
      return;
    }
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`Upload failed: ${xhr.statusText}`));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(formData);
      });

      setFileId(result.file_id);
      setUploading(false);

      const procRes = await fetch(`${API}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: result.file_id,
          client_name: clientName.trim(),
          project_id: projectId,
          wm_x: wmX,
          wm_y: wmY,
          wm_opacity: wmOpacity,
          wm_font_size: wmFontSize,
          ...(logoId && { logo_id: logoId }),
          logo_scale: logoScale,
          quality: quality,
          codec: codec,
        }),
      });
      const procData = await procRes.json();

      if (!procRes.ok) throw new Error(procData.detail || 'Process request failed');

      setJobId(procData.job_id);
      setJobStatus('pending');
    } catch (err) {
      setError(err.message);
      setUploading(false);
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
          fetchProject();
        }
        if (data.status === 'error') {
          setError(data.error || 'Processing failed');
          clearInterval(pollRef.current);
        }
      } catch {
        // retry on next interval
      }
    }, 1000);

    return () => clearInterval(pollRef.current);
  }, [jobId, jobStatus, fetchProject]);

  const isProcessing = jobStatus === 'pending' || jobStatus === 'processing';

  if (projectLoading) {
    return (
      <div className="app">
        <header className="header">
          <h1 className="logo">WatermarkPro</h1>
        </header>
        <div className="project-layout">
          <div className="project-main">
            <div style={{ textAlign: 'center', padding: '60px 0' }}><div className="spinner" /></div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="app">
        <header className="header">
          <h1 className="logo">WatermarkPro</h1>
        </header>
        <div className="project-layout">
          <div className="project-main" style={{ textAlign: 'center', padding: '60px 0' }}>
            <p>Проект не найден</p>
            <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => navigate('/')}>На главную</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-nav">
          <button className="btn-back" onClick={() => navigate('/')}>
            &#8592; Проекты
          </button>
        </div>
        <h1 className="logo">{project.name}</h1>
      </header>

      <div className="project-layout">
        {/* ── Left: main content ────────────────────────────────────── */}
        <div className="project-main">

          {/* Upload form */}
          {!jobId && (
            <>
              {/* Video dropzone = watermark WYSIWYG preview */}
              <div
                className={`video-dropzone ${!file ? 'video-dropzone--empty' : ''} ${dragOver ? 'video-dropzone--drag' : ''}`}
                ref={previewRef}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={!file ? () => document.getElementById('file-input').click() : undefined}
                onMouseDown={file ? onPreviewMouseDown : undefined}
                onMouseMove={file ? onPreviewMouseMove : undefined}
                onMouseUp={file ? onPreviewMouseUp : undefined}
                onTouchStart={file ? onPreviewMouseDown : undefined}
                onTouchMove={file ? onPreviewMouseMove : undefined}
                onTouchEnd={file ? onPreviewMouseUp : undefined}
              >
                <input
                  id="file-input"
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelect}
                  hidden
                />

                {/* Empty state */}
                {!file && (
                  <div className="video-drop-hint">
                    <span className="drop-icon">&#8683;</span>
                    <p>Перетащите видео сюда</p>
                    <p className="drop-sub">или нажмите для выбора</p>
                  </div>
                )}

                {/* File loaded — video preview + watermark overlay */}
                {file && videoPreviewUrl && (
                  <>
                    {/* Actual video first frame as background */}
                    <video
                      ref={videoPreviewRef}
                      src={videoPreviewUrl}
                      muted
                      preload="metadata"
                      playsInline
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        pointerEvents: 'none',
                      }}
                      onLoadedData={(e) => { e.target.currentTime = 0.5; }}
                    />

                    {/* Timecode preview */}
                    <span
                      className="wm-preview-timecode"
                      style={{
                        fontSize: `${Math.max(10, Math.round(36 * previewWidth / 1920 * 1.5))}px`,
                        opacity: Math.max(0.35, Math.min((1 - wmOpacity / 100) + 0.4, 1)),
                      }}
                    >
                      00:00:00:00
                    </span>

                    {/* Watermark text + logo marker */}
                    {(clientName.trim() || (logoFile && logoPreviewUrl)) && (
                      <div
                        className="wm-preview-marker"
                        style={{
                          left: `${wmX}%`,
                          top: `${wmY}%`,
                          gap: '0px',
                        }}
                      >
                        {clientName.trim() && (
                          <span
                            className="wm-preview-text"
                            style={{
                              fontSize: `${Math.max(10, Math.round(wmFontSize * previewWidth / 1920 * 1.5))}px`,
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

                    {/* File info badge */}
                    <div
                      className="video-file-badge"
                      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); document.getElementById('file-input').click(); }}
                      title="Нажмите чтобы заменить"
                    >
                      &#127916; {file.name} &middot; {formatSize(file.size)}
                    </div>
                  </>
                )}
              </div>

              {/* Settings panels */}
              <div className="settings-row">
                {/* Watermark settings */}
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
                      <input
                        className="form-slider"
                        type="range" min="20" max="80"
                        value={wmOpacity}
                        onChange={(e) => setWmOpacity(Number(e.target.value))}
                      />
                    </div>
                    <div className="form-row-item">
                      <label className="form-label">Шрифт: {wmFontSize}px</label>
                      <input
                        className="form-slider"
                        type="range" min="16" max="120"
                        value={wmFontSize}
                        onChange={(e) => setWmFontSize(Number(e.target.value))}
                      />
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
                      <input
                        className="form-slider"
                        type="range" min="10" max="50"
                        value={logoScale}
                        onChange={(e) => setLogoScale(Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>

                {/* Output settings */}
                <div className="settings-panel">
                  <h4 className="settings-panel-title">Настройки вывода</h4>

                  <div className="form-group">
                    <label className="form-label">Качество</label>
                    <select
                      className="form-select"
                      value={quality}
                      onChange={(e) => setQuality(e.target.value)}
                    >
                      <option value="low">Низкое (быстро)</option>
                      <option value="medium">Среднее</option>
                      <option value="high">Лучшее (медленно)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Формат</label>
                    <select
                      className="form-select"
                      value={codec}
                      onChange={(e) => setCodec(e.target.value)}
                    >
                      <option value="mp4">MP4</option>
                      <option value="mov">MOV</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Process button */}
              <button
                className="btn-primary"
                onClick={upload}
                disabled={!file || !clientName.trim() || uploading}
              >
                {uploading ? `Загрузка... ${uploadProgress}%` : 'Загрузить и обработать'}
              </button>

              {uploading && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </>
          )}

          {/* Processing */}
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

          {/* Result */}
          {jobStatus === 'done' && watchUrl && (
            <div className="result">
              <span className="result-icon">&#10003;</span>
              <h2>Готово!</h2>
              <div className="result-actions">
                <a href={`/review/${jobId}`} className="btn-watch">
                  Рецензировать
                </a>
                {downloadUrl && (
                  <a href={downloadUrl} download className="btn-download">
                    Скачать {codec.toUpperCase()}
                  </a>
                )}
              </div>
              <div className="link-box">
                <input readOnly value={watchUrl} onClick={(e) => e.target.select()} />
                <button onClick={() => navigator.clipboard.writeText(watchUrl)}>Копировать</button>
              </div>
              <div className="notify-email-box">
                <label>Email для уведомлений</label>
                <div className="notify-email-row">
                  <input
                    type="email"
                    placeholder="user@example.com"
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    className="notify-email-input"
                  />
                  <button
                    className="notify-email-btn"
                    disabled={!notifyEmail.trim() || !notifyEmail.includes('@')}
                    onClick={() => { alert('Уведомления включены для ' + notifyEmail); }}
                  >
                    Подписаться
                  </button>
                </div>
              </div>
              <button className="btn-new" onClick={resetForm}>Загрузить ещё</button>
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

        {/* ── Right: sidebar with project files ─────────────────────── */}
        <div className="project-sidebar">
          <h3 className="sidebar-title">Файлы проекта</h3>
          {project.jobs && project.jobs.length > 0 ? (
            <div className="job-grid">
              {project.jobs.map((job) => (
                <div
                  key={job.id}
                  className={`job-thumb-card ${job.status === 'done' ? 'job-thumb-card--clickable' : ''}`}
                  onClick={() => job.status === 'done' && navigate(`/review/${job.id}`)}
                >
                  <div className="job-thumb-preview">
                    <span className="job-thumb-icon">&#127916;</span>
                    {job.status !== 'done' && (
                      <span className={`job-thumb-badge ${
                        job.status === 'processing' ? 'badge-processing' :
                        job.status === 'pending' ? 'badge-pending' : 'badge-error'
                      }`}>
                        {job.status === 'processing' ? 'Обработка...' :
                         job.status === 'pending' ? 'В очереди' : 'Ошибка'}
                      </span>
                    )}
                  </div>
                  <div className="job-thumb-info">
                    <span className="job-thumb-name">{job.filename || 'video'}</span>
                    <span className="job-thumb-client">{job.client_name}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#999', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
              Нет файлов
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProjectPage;
