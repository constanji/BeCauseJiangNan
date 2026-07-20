import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, FileBarChart, Radio, Settings2 } from 'lucide-react';

const nav = [
  { to: '/', label: '端点', icon: Settings2 },
  { to: '/probe', label: '探测', icon: Radio },
  { to: '/reports', label: '报告', icon: FileBarChart },
];

export default function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-black/10 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Activity className="h-7 w-7 text-accent" strokeWidth={2.2} />
            <div>
              <div className="text-xl font-semibold tracking-tight text-ink">ModelProbe</div>
              <div className="text-xs text-black/55">模型身份 · 延迟 · 吞吐 · 上下文窗口</div>
            </div>
          </div>
          <nav className="flex gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-accent text-white' : 'text-black/70 hover:bg-black/5'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
