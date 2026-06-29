import React from 'react';
import { cn } from '../lib/cn';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone, duration?: number) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, string> = {
  success: 'border-green-500 bg-green-600',
  error: 'border-red-500 bg-red-600',
  warning: 'border-amber-500 bg-amber-600',
  info: 'border-gray-500 bg-gray-600',
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
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4">
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'toast-popup max-w-lg rounded-md border px-4 py-3 text-sm font-medium text-white shadow-lg',
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
