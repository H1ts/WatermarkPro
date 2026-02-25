import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const API = '/api';

function SharePasswordSetter({ jobId }) {
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    fetch(`${API}/share/${jobId}/check`)
      .then(r => r.json())
      .then(d => setHasPassword(d.has_password))
      .catch(() => {});
  }, [jobId]);

  const save = async () => {
    const res = await fetch(`${API}/share/${jobId}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password || null }),
    });
    if (res.ok) {
      setSaved(true);
      setHasPassword(!!password);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="share-password-setter">
      <label className="share-pw-label">
        {hasPassword ? 'Пароль установлен' : 'Установить пароль (необязательно)'}
      </label>
      <div className="link-box">
        <input
          type="text"
          placeholder={hasPassword ? 'Новый пароль (пусто = снять)' : 'Пароль для ссылки'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={save}>{saved ? 'Сохранено!' : 'Сохранить'}</button>
      </div>
    </div>
  );
}

function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  // Project data
  const [project, setProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(true);

  // Upload & process state
  const [file, setFile] = useState(null);
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
  const [notifyEmail, setNotifyEmail] = useState(() => localStorage.getItem('wmpro_notify_email') || '');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileId, setFileId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [watchUrl, setWatchUrl] = useState(null);
  const [shareUrl, setShareUrl] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const pollRef = useRef(null);
  const previewRef = useRef(null);
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

  // Track preview container width — re-run when form becomes visible
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
    setShareUrl(null);
    setDownloadUrl(null);
    setError(null);
    setUploadProgress(0);
  };

  const handleLogoSelect = async (e) => {
    const selected = e.target.files[0];
    if (!selected) return;
    if (selected.size > 5 * 1024 * 1024) {
      setError('Logo too large (max 5 MB)');
      return;
    }
    if (!selected.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, WebP)');
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
      setError('Выберите файл и введите имя клиента');
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
          ...(notifyEmail.trim() && { notification_email: notifyEmail.trim() }),
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
          setShareUrl(data.share_url);
          setDownloadUrl(data.download_url);
          clearInterval(pollRef.current);
          fetchProject(); // refresh job list
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
        <main className="main">
          <div className="dashboard-empty"><div className="spinner" /></div>
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="app">
        <header className="header">
          <h1 className="logo">WatermarkPro</h1>
        </header>
        <main className="main">
          <div className="dashboard-empty">
            <p>Проект не найден</p>
            <button className="btn-new" onClick={() => navigate('/')}>На главную</button>
          </div>
        </main>
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

      <main className="main">
        {/* Upload form — show when no active job */}
        {!jobId && (
          <>
            <div
              className={`dropzone ${dragOver ? 'dropzone--active' : ''} ${file ? 'dropzone--has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input').click()}
            >
              <input
                id="file-input"
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                hidden
              />
              {file ? (
                <div className="file-info">
                  <span className="file-icon">&#127916;</span>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formatSize(file.size)}</span>
                </div>
              ) : (
                <div className="drop-hint">
                  <span className="drop-icon">&#8683;</span>
                  <p>Перетащите видео сюда</p>
                  <p className="drop-sub">или нажмите для выбора</p>
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="client-name">Имя клиента (текст watermark)</label>
              <input
                id="client-name"
                type="text"
                placeholder="Иванов Иван Иванович"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>

            <div className="wm-settings">
              <h3 className="wm-settings-title">Настройки watermark</h3>

              <div className="wm-row">
                <label>Позиция (перетащите метку)</label>
                <div
                  className="wm-preview"
                  ref={previewRef}
                  onMouseDown={onPreviewMouseDown}
                  onMouseMove={onPreviewMouseMove}
                  onMouseUp={onPreviewMouseUp}
                  onTouchStart={onPreviewMouseDown}
                  onTouchMove={onPreviewMouseMove}
                  onTouchEnd={onPreviewMouseUp}
                >
                  <span
                    className="wm-preview-timecode"
                    style={{
                      fontSize: `${Math.max(10, Math.round(36 * previewWidth / 1920 * 1.5))}px`,
                      opacity: Math.max(0.35, Math.min((1 - wmOpacity / 100) + 0.4, 1)),
                    }}
                  >
                    00:00:00:00
                  </span>
                  <div
                    className="wm-preview-marker"
                    style={{
                      left: `${wmX}%`,
                      top: `${wmY}%`,
                      gap: `${Math.max(4, Math.round(Math.max(10, wmFontSize / 4) * previewWidth / 1920 * 1.5))}px`,
                    }}
                  >
                    <span
                      className="wm-preview-text"
                      style={{
                        fontSize: `${Math.max(10, Math.round(wmFontSize * previewWidth / 1920 * 1.5))}px`,
                        opacity: Math.max(0.3, 1 - wmOpacity / 100),
                      }}
                    >
                      {clientName.trim() || 'ФИО'}
                    </span>
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
                </div>
              </div>

              <div className="wm-row">
                <label>Прозрачность: {wmOpacity}%</label>
                <input
                  type="range" min="20" max="80"
                  value={wmOpacity}
                  onChange={(e) => setWmOpacity(Number(e.target.value))}
                  className="wm-slider"
                />
                <div className="wm-range-labels"><span>20%</span><span>80%</span></div>
              </div>

              <div className="wm-row">
                <label>Размер шрифта: {wmFontSize}px</label>
                <input
                  type="range" min="16" max="120"
                  value={wmFontSize}
                  onChange={(e) => setWmFontSize(Number(e.target.value))}
                  className="wm-slider"
                />
                <div className="wm-range-labels"><span>16px</span><span>120px</span></div>
              </div>

              <div className="wm-row">
                <label>Лого (PNG, JPG, WebP, до 5 МБ)</label>
                {logoFile ? (
                  <div className="logo-preview">
                    <img src={logoPreviewUrl} alt="Logo preview" className="logo-thumb" />
                    <span className="logo-name">{logoFile.name}</span>
                    <button type="button" className="logo-remove" onClick={removeLogo}>&#10005;</button>
                  </div>
                ) : (
                  <button
                    type="button" className="logo-upload-btn"
                    onClick={() => document.getElementById('logo-input').click()}
                    disabled={logoUploading}
                  >
                    {logoUploading ? 'Загрузка...' : 'Выбрать лого'}
                  </button>
                )}
                <input id="logo-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoSelect} hidden />
              </div>

              {logoFile && (
                <div className="wm-row">
                  <label>Масштаб лого: {logoScale}%</label>
                  <input
                    type="range" min="10" max="50"
                    value={logoScale}
                    onChange={(e) => setLogoScale(Number(e.target.value))}
                    className="wm-slider"
                  />
                  <div className="wm-range-labels"><span>10%</span><span>50%</span></div>
                </div>
              )}

              <div className="wm-row">
                <label>Качество</label>
                <div className="option-group">
                  {[
                    { value: 'low', label: 'Низкое' },
                    { value: 'medium', label: 'Среднее' },
                    { value: 'high', label: 'Лучшее' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`option-btn ${quality === opt.value ? 'option-btn--active' : ''}`}
                      onClick={() => setQuality(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wm-row">
                <label>Формат</label>
                <div className="option-group">
                  {[
                    { value: 'mp4', label: 'MP4' },
                    { value: 'mov', label: 'MOV' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`option-btn ${codec === opt.value ? 'option-btn--active' : ''}`}
                      onClick={() => setCodec(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="notify-email">Email для уведомлений (необязательно)</label>
              <input
                id="notify-email"
                type="email"
                placeholder="you@example.com"
                value={notifyEmail}
                onChange={(e) => {
                  setNotifyEmail(e.target.value);
                  localStorage.setItem('wmpro_notify_email', e.target.value);
                }}
              />
            </div>

            <button
              className="btn-process"
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
              <div className="progress-fill progress-fill--render" style={{ width: `${jobProgress}%` }} />
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
            <p className="link-label">Ссылка для клиента:</p>
            <div className="link-box">
              <input readOnly value={shareUrl || watchUrl} onClick={(e) => e.target.select()} />
              <button onClick={() => navigator.clipboard.writeText(shareUrl || watchUrl)}>Копировать</button>
            </div>
            <SharePasswordSetter jobId={jobId} />
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

        {/* Job history */}
        {project.jobs && project.jobs.length > 0 && !isProcessing && (
          <div className="job-history">
            <h3 className="job-history-title">Файлы проекта</h3>
            {project.jobs.map((job) => (
              <div key={job.id} className="job-card">
                <div className="job-card-info">
                  <div className="job-card-name-row">
                    <span className="job-card-name">{job.filename || 'video'}</span>
                    {job.version > 1 && <span className="job-card-version">V{job.version}</span>}
                    {job.status === 'done' && job.review_status && (
                      <span className={`job-card-review-status review-status--${job.review_status}`}>
                        {job.review_status === 'approved' && 'Утверждено'}
                        {job.review_status === 'needs_revision' && 'Правки'}
                        {job.review_status === 'pending_review' && 'На рецензии'}
                      </span>
                    )}
                  </div>
                  <span className="job-card-client">{job.client_name}</span>
                </div>
                <div className="job-card-actions">
                  {job.status === 'done' && (
                    <>
                      <a href={`/share/${job.id}`} target="_blank" rel="noopener noreferrer" className="job-card-link job-card-watch">
                        Смотреть
                      </a>
                      <button
                        className="job-card-link job-card-share"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = job.share_url || `${window.location.origin}/share/${job.id}`;
                          const btn = e.target;
                          try {
                            const ta = document.createElement('textarea');
                            ta.value = url;
                            ta.style.position = 'fixed';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            btn.textContent = 'Скопировано!';
                          } catch {
                            btn.textContent = 'Ошибка';
                          }
                          setTimeout(() => { btn.textContent = 'Поделиться'; }, 1500);
                        }}
                      >
                        Поделиться
                      </button>
                      <a href={job.download_url} download className="job-card-link job-card-download">
                        Скачать {(job.codec || 'mp4').toUpperCase()}
                      </a>
                      <a href={`/review/${job.id}`} className="job-card-link">
                        Рецензировать
                      </a>
                    </>
                  )}
                  {job.status === 'processing' && <span className="job-card-badge badge-processing">Обработка</span>}
                  {job.status === 'pending' && <span className="job-card-badge badge-pending">В очереди</span>}
                  {job.status === 'error' && <span className="job-card-badge badge-error">Ошибка</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default ProjectPage;
