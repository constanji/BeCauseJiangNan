import React from 'react';
import { cn } from '../lib/cn';

export default function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label ?? (checked ? '已开启' : '已关闭')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        checked ? 'bg-brand' : 'bg-surface-tertiary',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function HideInCartToggle({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cn('flex shrink-0 cursor-pointer items-center gap-3 text-sm', className)}>
      <ToggleSwitch
        checked={checked}
        onChange={onChange}
        label="隐藏已加入导出篮"
      />
      <span className="select-none text-text-secondary">隐藏已加入导出篮</span>
    </label>
  );
}
