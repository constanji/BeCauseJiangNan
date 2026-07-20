import React, { useEffect, useState } from 'react';
import { KeyRound, X } from 'lucide-react';

const STORAGE_KEY = 'modelProbeSecret';

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  reason?: string;
};

export function getStoredSecret() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function setStoredSecret(value: string) {
  const v = value.trim();
  if (v) localStorage.setItem(STORAGE_KEY, v);
  else localStorage.removeItem(STORAGE_KEY);
}

/** 访问密钥弹窗：与服务器 .env 的 MODEL_PROBE_SECRET 一致 */
export default function SecretModal({ open, onClose, onSaved, reason }: Props) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue(getStoredSecret());
  }, [open]);

  if (!open) return null;

  const save = () => {
    setStoredSecret(value);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">访问密钥</h2>
            <p className="mt-1 text-sm text-black/55">
              填写与服务器 <code className="rounded bg-black/5 px-1">.env</code> 里{' '}
              <code className="rounded bg-black/5 px-1">MODEL_PROBE_SECRET</code> 相同的值
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-black/40 hover:bg-black/5" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        {reason && (
          <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn">{reason}</div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">MODEL_PROBE_SECRET</span>
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="w-full rounded-lg border border-black/15 px-3 py-2 font-mono text-sm"
            placeholder="粘贴服务器上的密钥"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">
            取消
          </button>
          <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white">
            <KeyRound className="h-4 w-4" />
            保存并重试
          </button>
        </div>
      </div>
    </div>
  );
}
