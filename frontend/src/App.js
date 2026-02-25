import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './Dashboard';
import ProjectPage from './ProjectPage';
import ReviewPage from './ReviewPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/review/:jobId" element={<ReviewPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
