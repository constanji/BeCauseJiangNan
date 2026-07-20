import React from 'react';
import { HelpCircle } from 'lucide-react';

type Props = {
  text: string;
  className?: string;
};

/** 小问号，悬停显示说明 */
export default function HelpTip({ text, className = '' }: Props) {
  return (
    <span className={`group relative inline-flex align-middle ${className}`} tabIndex={0}>
      <HelpCircle className="h-3.5 w-3.5 cursor-help text-black/35 hover:text-accent" aria-label="说明" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
