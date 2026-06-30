import React from 'react';

type Tone = 'error' | 'warning' | 'success';

export default function StatusBanner({
  tone,
  title,
  message,
  children,
}: {
  tone: Tone;
  title: string;
  message?: string | React.ReactNode;
  children?: React.ReactNode;
}) {
  const styles = {
    error: 'border-red-500/30 bg-red-950/40 text-red-100',
    warning: 'border-amber-500/30 bg-amber-950/35 text-amber-100',
    success: 'border-green-500/30 bg-green-950/35 text-green-100',
  } as const;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${styles[tone]}`}>
      <div className="font-medium">{title}</div>
      {message ? <div className="mt-1 text-xs opacity-90">{message}</div> : null}
      {children}
    </div>
  );
}
