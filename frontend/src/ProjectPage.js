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
  const [wmX, setWmX] = useState(50);
  const [wmY, setWmY] = useState(50);
  const [wmOpacity, setWmOpacity] = useState(30);
  const [wmFontSize, setWmFontSize] = useState(48);
  const [logoFile, setLogoFile] = useState(null);
  const [logoId, setLogoId] = useState(null);
  const [logoScale, setLogoScale] = useState(25);
  const [logoUploading, setLogoUploading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileId, setFileId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [watchUrl, setWatchUrl] = useState(null);
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

  // Track preview container width
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPreviewWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const resetForm = () => {
    setFile(null);
    setFileId(null);
    setJobId(null);
    setJobStatus(null);
    setJobProgress(0);
    setWatchUrl(null);
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
    } finally {
      setLogoUploading(false);
    }
  };

  const removeLogo = () => {
    setLogoFile(null);
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
                      fontSize: `${Math.max(8, Math.round(36 * previewWidth / 1920))}px`,
                      opacity: Math.min((1 - wmOpacity / 100) + 0.4, 1),
                    }}
                  >
                    00:00:00:00
                  </span>
                  <div
                    className="wm-preview-marker"
                    style={{
                      left: `${wmX}%`,
                      top: `${wmY}%`,
                      gap: `${Math.max(2, Math.round(Math.max(10, wmFontSize / 4) * previewWidth / 1920))}px`,
                    }}
                  >
                    <span
                      className="wm-preview-text"
                      style={{
                        fontSize: `${Math.max(8, Math.round(wmFontSize * previewWidth / 1920))}px`,
                        opacity: 1 - wmOpacity / 100,
                      }}
                    >
                      {clientName.trim() || 'ФИО'}
                    </span>
                    {logoFile && (
                      <img
                        src={URL.createObjectURL(logoFile)}
                        alt=""
                        className="wm-preview-logo"
                        style={{
                          width: `${Math.round(previewWidth * logoScale / 100)}px`,
                          opacity: 1 - wmOpacity / 100,
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
                    <img src={URL.createObjectURL(logoFile)} alt="Logo preview" className="logo-thumb" />
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
            <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="btn-watch">
              Открыть плеер
            </a>
            <div className="link-box">
              <input readOnly value={watchUrl} onClick={(e) => e.target.select()} />
              <button onClick={() => navigator.clipboard.writeText(watchUrl)}>Копировать</button>
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

        {/* Job history */}
        {project.jobs && project.jobs.length > 0 && !isProcessing && (
          <div className="job-history">
            <h3 className="job-history-title">Файлы проекта</h3>
            {project.jobs.map((job) => (
              <div key={job.id} className="job-card">
                <div className="job-card-info">
                  <span className="job-card-name">{job.filename || 'video'}</span>
                  <span className="job-card-client">{job.client_name}</span>
                </div>
                <div className="job-card-status">
                  {job.status === 'done' && (
                    <a href={job.watch_url} target="_blank" rel="noopener noreferrer" className="job-card-link">
                      Смотреть
                    </a>
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
