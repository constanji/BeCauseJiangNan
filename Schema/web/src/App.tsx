import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ExportLayout from './components/ExportLayout';
import LightSchemaLayout from './components/LightSchemaLayout';
import { UiStateProvider } from './context/UiStateProvider';
import { ToastProvider } from './context/ToastProvider';
import DataSourceList from './pages/DataSourceList';
import DataSourceForm from './pages/DataSourceForm';
import Workbench from './pages/Workbench';
import LightSchemaLibrary from './pages/LightSchemaLibrary';
import ReviewPage from './pages/ReviewPage';
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
            <Route path="/library" element={<LightSchemaLayout />}>
              <Route index element={<LightSchemaLibrary />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="search" element={<LightSchemaSearch />} />
            </Route>
            <Route path="/review" element={<Navigate to="/library/review" replace />} />
            <Route path="/search" element={<Navigate to="/library/search" replace />} />
            <Route path="/tags" element={<TagManagement />} />
            <Route path="/export" element={<ExportLayout />}>
              <Route index element={<ExportPage />} />
              <Route path="review" element={<ReviewPage cartOnly />} />
              <Route path="search" element={<LightSchemaSearch cartOnly />} />
            </Route>
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
