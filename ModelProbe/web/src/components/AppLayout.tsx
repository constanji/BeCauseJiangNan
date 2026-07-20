import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, FileBarChart, GitCompare, KeyRound, Radio, Settings2, ShieldCheck } from 'lucide-react';
import SecretModal, { getStoredSecret } from './SecretModal';

const nav = [
  { to: '/', label: '端点', icon: Settings2 },
  { to: '/probe', label: '性能', icon: Radio },
  { to: '/capability', label: '规范', icon: ShieldCheck },
  { to: '/reports', label: '报告', icon: FileBarChart },
  { to: '/compare', label: '对比', icon: GitCompare },
];

export default function AppLayout() {
  const [secretOpen, setSecretOpen] = useState(false);
  const [hasSecret, setHasSecret] = useState(() => Boolean(getStoredSecret()));

  return (
    <div className="min-h-screen">
      <header className="border-b border-black/10 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Activity className="h-7 w-7 text-accent" strokeWidth={2.2} />
            <div>
              <div className="text-xl font-semibold tracking-tight text-ink">ModelProbe</div>
              <div className="text-xs text-black/55">模型身份 · 延迟 · 规范 · 工具协议</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
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
            <button
              type="button"
              onClick={() => setSecretOpen(true)}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-black/60 hover:bg-black/5"
              title="访问密钥"
            >
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">{hasSecret ? '已设密钥' : '访问密钥'}</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <SecretModal
        open={secretOpen}
        onClose={() => setSecretOpen(false)}
        onSaved={() => {
          setHasSecret(Boolean(getStoredSecret()));
          window.location.reload();
        }}
        reason="若接口返回 Unauthorized，请在此填入与服务器 .env 中 MODEL_PROBE_SECRET 相同的值"
      />
    </div>
  );
}
