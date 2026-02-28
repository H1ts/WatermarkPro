import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePanelToggle, useFilePanel } from './FilePanel';

const API = '/api';

function ReviewSelectPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const { open: openFilePanel } = useFilePanel();

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

  return (
    <div className="app">
      <header className="header">
        <div className="header-nav">
          <button className="btn-back" onClick={() => navigate('/')}>&#8592; Главная</button>
        </div>
        <h1 className="logo">Рецензирование</h1>
        <FilePanelToggle />
      </header>

      <div className="page-content">
        <h2 className="section-title">Выберите видео для рецензирования</h2>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" /></div>
        )}

        {!loading && jobs.length === 0 && (
          <div className="empty-state">
            <p>Нет обработанных видео</p>
            <p className="empty-state-sub">Сначала загрузите и обработайте видео</p>
            <button className="btn-primary" style={{ width: 'auto', padding: '10px 24px', marginTop: 16 }} onClick={openFilePanel}>
              Загрузить видео
            </button>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <div className="file-library-grid">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="file-library-card"
                onClick={() => navigate(`/review/${job.id}`)}
              >
                <div className="file-library-thumb">
                  <span className="file-library-icon">&#9654;</span>
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
    </div>
  );
}

export default ReviewSelectPage;
