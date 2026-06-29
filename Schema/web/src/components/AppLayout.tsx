import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useUiState } from '../context/UiStateProvider';
import { cn } from '../lib/cn';
import Button from './Button';

const tabs = [
  { id: 'dataSources', label: '数据源管理', path: '/' },
  { id: 'library', label: 'LightSchema 库', path: '/library' },
  { id: 'tags', label: '标签管理', path: '/tags' },
  { id: 'export', label: '导出', path: '/export' },
] as const;

function isTabActive(path: string, locationPath: string) {
  if (path === '/') {
    return locationPath === '/'
      || locationPath.startsWith('/new')
      || locationPath.startsWith('/edit');
  }
  if (path === '/library') {
    return locationPath === '/library'
      || locationPath.startsWith('/library/');
  }
  if (path === '/export') {
    return locationPath === '/export'
      || locationPath.startsWith('/export/');
  }
  return locationPath.startsWith(path);
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { cartCount } = useUiState();
  const isWorkbench = location.pathname.startsWith('/workbench');
  const showBack = location.pathname !== '/';

  return (
    <div className="flex min-h-screen flex-col bg-background text-text-primary">
      <div className="px-4 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">项目管理</h1>
            <p className="mt-1 text-sm text-text-secondary">管理数据库数据源与 LightSchema</p>
          </div>
          {showBack && (
            <Button variant="neutral" className="shrink-0 px-3 py-2" onClick={() => navigate('/')}>
              <ChevronLeft className="h-4 w-4" />
              返回
            </Button>
          )}
        </div>
      </div>

      {!isWorkbench && (
        <div className="mt-4 border-b border-border-light bg-surface-secondary">
          <div className="flex gap-1 overflow-x-auto px-4 pt-2">
            {tabs.map((tab) => {
              const active = isTabActive(tab.path, location.pathname);
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => navigate(tab.path)}
                  className={cn(
                    'relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'border-brand text-text-primary'
                      : 'border-transparent text-text-secondary hover:border-border-medium hover:text-text-primary',
                  )}
                >
                  {tab.label}
                  {tab.id === 'export' && cartCount > 0 && (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-xs text-white">{cartCount}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
