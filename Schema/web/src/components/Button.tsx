import React from 'react';
import { cn } from '../lib/cn';

type Variant = 'primary' | 'neutral';

export default function Button({
  variant = 'neutral',
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cn(
        'btn relative inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'btn-primary',
        variant === 'neutral' && 'btn-neutral',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
