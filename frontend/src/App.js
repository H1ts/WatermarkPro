import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './Dashboard';
import WatermarkPage from './WatermarkPage';
import ReviewSelectPage from './ReviewSelectPage';
import ReviewPage from './ReviewPage';
import ComparePage from './ComparePage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/watermark" element={<WatermarkPage />} />
        <Route path="/review-select" element={<ReviewSelectPage />} />
        <Route path="/review/:jobId" element={<ReviewPage />} />
        <Route path="/compare" element={<ComparePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
