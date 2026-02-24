import React, { useState, useCallback, useRef, useEffect } from 'react';
import './App.css';

const API = '/api';

function App() {
  const [file, setFile] = useState(null);
  const [clientName, setClientName] = useState('');
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

  const resetState = () => {
    setFile(null);
    setFileId(null);
    setJobId(null);
    setJobStatus(null);
    setJobProgress(0);
    setWatchUrl(null);
    setError(null);
    setUploadProgress(0);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type.startsWith('video/')) {
      resetState();
      setFile(dropped);
    } else {
      setError('Please drop a video file');
    }
  }, []);

  const handleFileSelect = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      resetState();
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
      setError('Select a file and enter client name');
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
        body: JSON.stringify({ file_id: result.file_id, client_name: clientName.trim() }),
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
  }, [jobId, jobStatus]);

  const isProcessing = jobStatus === 'pending' || jobStatus === 'processing';

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">WatermarkPro</h1>
        <p className="subtitle">Video watermark & secure streaming</p>
      </header>

      <main className="main">
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
                  <p>Drag & drop video here</p>
                  <p className="drop-sub">or click to select</p>
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="client-name">Client name (watermark text)</label>
              <input
                id="client-name"
                type="text"
                placeholder="Ivanov Ivan Ivanovich"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>

            <button
              className="btn-process"
              onClick={upload}
              disabled={!file || !clientName.trim() || uploading}
            >
              {uploading ? `Uploading... ${uploadProgress}%` : 'Upload & Process'}
            </button>

            {uploading && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </>
        )}

        {isProcessing && (
          <div className="processing">
            <div className="spinner" />
            <h2>Processing video...</h2>
            <p className="status-text">{jobStatus === 'pending' ? 'Queued' : 'Encoding'}</p>
            <div className="progress-bar">
              <div className="progress-fill progress-fill--render" style={{ width: `${jobProgress}%` }} />
            </div>
            <p className="progress-text">{jobProgress}%</p>
          </div>
        )}

        {jobStatus === 'done' && watchUrl && (
          <div className="result">
            <span className="result-icon">&#10003;</span>
            <h2>Ready!</h2>
            <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="btn-watch">
              Open Player
            </a>
            <div className="link-box">
              <input readOnly value={watchUrl} onClick={(e) => e.target.select()} />
              <button onClick={() => navigator.clipboard.writeText(watchUrl)}>Copy</button>
            </div>
            <button className="btn-new" onClick={resetState}>Process another</button>
          </div>
        )}

        {error && (
          <div className="error">
            <p>{error}</p>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
