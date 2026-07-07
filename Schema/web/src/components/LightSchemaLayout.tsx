import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/cn';

const subTabs = [
  { id: 'home', label: '主页', path: '/library' },
  { id: 'review', label: '审查', path: '/library/review' },
  { id: 'search', label: '搜索', path: '/library/search' },
  { id: 'explore', label: '找表', path: '/library/explore' },
] as const;

function isSubTabActive(path: string, locationPath: string) {
  if (path === '/library') {
    return locationPath === '/library';
  }
  return locationPath.startsWith(path);
}

export default function LightSchemaLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border-light bg-surface-primary">
        <div className="flex gap-1 overflow-x-auto px-4 pt-2">
          {subTabs.map((tab) => {
            const active = isSubTabActive(tab.path, location.pathname);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(tab.path)}
                className={cn(
                  'relative flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-brand text-text-primary'
                    : 'border-transparent text-text-secondary hover:border-border-medium hover:text-text-primary',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
