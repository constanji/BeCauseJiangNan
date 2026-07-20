import React, { useEffect, useState } from 'react';
import { KeyRound, X } from 'lucide-react';

const STORAGE_KEY = 'tokenProbeSecret';

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
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-5 w-5 text-accent" /> 访问密钥
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-sm text-black/60">
          {reason || '与服务器 .env 中 TOKEN_PROBE_SECRET 保持一致'}
        </p>
        <input
          className="mb-4 w-full rounded-lg border border-black/10 px-3 py-2 font-mono text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="TOKEN_PROBE_SECRET"
        />
        <button
          type="button"
          onClick={save}
          className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
        >
          保存
        </button>
      </div>
    </div>
  );
}
