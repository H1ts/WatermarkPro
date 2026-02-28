import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API = '/api';

/* ── Context ───────────────────────────────────────────────────────── */

const FilePanelContext = createContext();

export function useFilePanel() {
  return useContext(FilePanelContext);
}

/* ── Provider ──────────────────────────────────────────────────────── */

export function FilePanelProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/files`);
      const data = await res.json();
      setFiles(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <FilePanelContext.Provider value={{ isOpen, toggle, open, close, files, loading, refresh }}>
      {children}
    </FilePanelContext.Provider>
  );
}

/* ── Toggle button (for headers) ───────────────────────────────────── */

export function FilePanelToggle() {
  const { toggle } = useFilePanel();
  return (
    <button
      className="btn-file-panel-toggle"
      onClick={toggle}
      title="Файлы"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="4" x2="17" y2="4" />
        <line x1="3" y1="10" x2="17" y2="10" />
        <line x1="3" y1="16" x2="17" y2="16" />
      </svg>
    </button>
  );
}

/* ── Panel component ───────────────────────────────────────────────── */

export function FilePanel() {
  const navigate = useNavigate();
  const { isOpen, close, files, loading, refresh } = useFilePanel();

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const selected = e.target.files[0];
    if (!selected) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selected);
      const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      await refresh();
      close();
      navigate(`/watermark?file_id=${data.file_id}`, { replace: true });
    } catch {
      close();
      navigate('/watermark');
    } finally {
      setUploading(false);
    }
  };

  const handleFileClick = (f) => {
    close();
    navigate(`/watermark?file_id=${f.file_id}`, { replace: true });
  };

  return (
    <>
      <div className={`file-panel ${isOpen ? 'file-panel--open' : ''}`}>
        <div className="file-panel-header">
          <h3 className="file-panel-title">Файлы</h3>
          <button className="file-panel-close" onClick={close}>&#10005;</button>
        </div>

        <div className="file-panel-upload">
          <button
            className="file-panel-upload-btn"
            onClick={() => document.getElementById('file-panel-input').click()}
            disabled={uploading}
          >
            {uploading ? 'Загрузка...' : '+ Загрузить видео'}
          </button>
          <input
            id="file-panel-input"
            type="file"
            accept="video/*"
            onChange={handleUpload}
            hidden
          />
        </div>

        <div className="file-panel-list">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}><div className="spinner" /></div>
          ) : files.length === 0 ? (
            <p className="file-panel-empty">Нет загруженных файлов</p>
          ) : (
            files.map((f) => (
              <div
                key={f.file_id}
                className="file-panel-item"
                onClick={() => handleFileClick(f)}
              >
                <div className="file-panel-item-thumb">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
                <div className="file-panel-item-info">
                  <span className="file-panel-item-name">{f.filename}</span>
                  <span className="file-panel-item-size">{formatSize(f.size)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {isOpen && <div className="file-panel-overlay" onClick={close} />}
    </>
  );
}
