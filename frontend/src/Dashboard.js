import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePanelToggle } from './FilePanel';

const features = [
  {
    key: 'watermark',
    title: 'ВАТЕРМАРК',
    description: 'Наложение текстового и графического водяного знака на видео',
    path: '/watermark',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    key: 'review',
    title: 'РЕЦЕНЗИРОВАНИЕ',
    description: 'Просмотр видео с комментариями привязанными к таймкоду',
    path: '/review-select',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    key: 'compare',
    title: 'СРАВНЕНИЕ ВЕРСИЙ',
    description: 'Сравнение двух версий видео side-by-side или в режиме A/B',
    path: '/compare',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="8" height="18" rx="1" />
        <rect x="14" y="3" width="8" height="18" rx="1" />
      </svg>
    ),
  },
];

function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">WatermarkPro</h1>
        <p className="subtitle">Video watermark & secure streaming</p>
        <FilePanelToggle />
      </header>

      <main className="dashboard">
        <h2 className="dashboard-title">Выберите инструмент</h2>
        <div className="feature-grid">
          {features.map((f) => (
            <div
              key={f.key}
              className="feature-card"
              onClick={() => navigate(f.path)}
            >
              <div className="feature-card-icon">{f.icon}</div>
              <h3 className="feature-card-title">{f.title}</h3>
              <p className="feature-card-desc">{f.description}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
