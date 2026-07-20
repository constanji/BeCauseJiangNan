import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ConnectionPage from './pages/ConnectionPage';
import RunPage from './pages/RunPage';
import ReportList from './pages/ReportList';
import ReportDetail from './pages/ReportDetail';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ConnectionPage />} />
          <Route path="/run" element={<RunPage />} />
          <Route path="/reports" element={<ReportList />} />
          <Route path="/reports/:taskId" element={<ReportDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
