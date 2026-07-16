import React from 'react';
import { cn } from '../lib/cn';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone, duration?: number) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, string> = {
  success: 'border-brand bg-brand',
  error: 'border-red-500 bg-red-500',
  warning: 'border-orange-500 bg-orange-500',
  info: 'border-gray-500 bg-gray-500',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = React.useState<{ message: string; tone: ToastTone } | null>(null);
  const hideTimer = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
  }, []);

  const showToast = React.useCallback((message: string, tone: ToastTone = 'success', duration = 3000) => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    setToast({ message, tone });
    hideTimer.current = window.setTimeout(() => setToast(null), duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-[100] flex justify-center px-4">
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'toast-popup pointer-events-auto inline-flex max-w-lg rounded-md border px-3 py-2 text-sm font-medium text-white shadow-[0_0_1px_rgba(67,90,111,0.3),0_5px_8px_-4px_rgba(67,90,111,0.3)]',
              toneStyles[toast.tone],
            )}
          >
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
