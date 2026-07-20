import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import EndpointList from './pages/EndpointList';
import EndpointForm from './pages/EndpointForm';
import ProbeRun from './pages/ProbeRun';
import ReportList from './pages/ReportList';
import ReportDetail from './pages/ReportDetail';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<EndpointList />} />
          <Route path="/endpoints/new" element={<EndpointForm mode="create" />} />
          <Route path="/endpoints/:id/edit" element={<EndpointForm mode="edit" />} />
          <Route path="/probe" element={<ProbeRun />} />
          <Route path="/reports" element={<ReportList />} />
          <Route path="/reports/:taskId" element={<ReportDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
