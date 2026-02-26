import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API = '/api';

function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API}/projects`);
      const data = await res.json();
      setProjects(data);
    } catch {
      setError('Не удалось загрузить проекты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error('Ошибка создания проекта');
      const project = await res.json();
      setShowModal(false);
      setNewName('');
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm('Удалить проект?')) return;
    try {
      await fetch(`${API}/projects/${projectId}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch {
      setError('Не удалось удалить проект');
    }
  };

  const formatDate = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">WatermarkPro</h1>
        <p className="subtitle">Video watermark & secure streaming</p>
      </header>

      <main className="dashboard">
        <div className="dashboard-top">
          <h2 className="dashboard-title">Проекты</h2>
          <button className="btn-create" onClick={() => setShowModal(true)}>
            + Новый проект
          </button>
        </div>

        {loading && (
          <div className="dashboard-empty">
            <div className="spinner" />
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="dashboard-empty">
            <span className="empty-icon">&#128193;</span>
            <p>Нет проектов</p>
            <p className="empty-sub">Создайте первый проект, чтобы начать работу</p>
          </div>
        )}

        {!loading && projects.length > 0 && (
          <div className="project-grid">
            {projects.map((p) => (
              <div
                key={p.id}
                className="project-card"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className="project-card-icon">&#127916;</div>
                <div className="project-card-body">
                  <h3 className="project-card-name">{p.name}</h3>
                  <div className="project-card-meta">
                    <span>{formatDate(p.created_at)}</span>
                    <span>{p.job_count} {p.job_count === 1 ? 'файл' : p.job_count >= 2 && p.job_count <= 4 ? 'файла' : 'файлов'}</span>
                  </div>
                </div>
                <button
                  className="project-card-delete"
                  onClick={(e) => deleteProject(e, p.id)}
                  title="Удалить проект"
                >
                  &#10005;
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="error">
            <p>{error}</p>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
      </main>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Новый проект</h3>
            <div className="form-group">
              <label htmlFor="project-name">Название проекта</label>
              <input
                id="project-name"
                type="text"
                placeholder="Мой проект"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() => { setShowModal(false); setNewName(''); }}
              >
                Отмена
              </button>
              <button
                className="btn-process"
                onClick={createProject}
                disabled={!newName.trim() || creating}
                style={{ width: 'auto', marginTop: 0, padding: '10px 24px' }}
              >
                {creating ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
