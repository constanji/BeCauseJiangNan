import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import { UiStateProvider } from './context/UiStateProvider';
import { ToastProvider } from './context/ToastProvider';
import DataSourceList from './pages/DataSourceList';
import DataSourceForm from './pages/DataSourceForm';
import Workbench from './pages/Workbench';
import LightSchemaLibrary from './pages/LightSchemaLibrary';
import TagManagement from './pages/TagManagement';
import LightSchemaSearch from './pages/LightSchemaSearch';
import ExportPage from './pages/ExportPage';

export default function App() {
  return (
    <UiStateProvider>
      <ToastProvider>
        <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DataSourceList />} />
            <Route path="/library" element={<LightSchemaLibrary />} />
            <Route path="/tags" element={<TagManagement />} />
            <Route path="/search" element={<LightSchemaSearch />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/new" element={<DataSourceForm mode="create" />} />
            <Route path="/edit/:id" element={<DataSourceForm mode="edit" />} />
            <Route path="/workbench/:id" element={<Workbench />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </UiStateProvider>
  );
}
