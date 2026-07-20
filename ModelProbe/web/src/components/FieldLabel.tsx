import React from 'react';
import HelpTip from './HelpTip';

type Props = {
  label: string;
  tip: string;
  children: React.ReactNode;
  className?: string;
};

export default function FieldLabel({ label, tip, children, className = '' }: Props) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 flex items-center gap-1.5 font-medium text-black/80">
        {label}
        <HelpTip text={tip} />
      </span>
      {children}
    </label>
  );
}
