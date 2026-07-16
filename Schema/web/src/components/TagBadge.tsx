import React from 'react';
import { Tag } from '../lib/uiState';
import { getTagDisplayName } from '../lib/tagDisplay';
import { cn } from '../lib/cn';

export default function TagBadge({
  tag,
  className,
  selected = false,
}: {
  tag: Tag;
  className?: string;
  selected?: boolean;
}) {
  const color = tag.color || '#10a37f';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none',
        className,
      )}
      style={{
        backgroundColor: `${color}22`,
        color,
        border: `1px solid ${selected ? color : `${color}55`}`,
        boxShadow: selected
          ? `0 0 0 2px var(--surface-primary), 0 0 0 4px ${color}88`
          : undefined,
      }}
    >
      <span
        className="block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {getTagDisplayName(tag)}
    </span>
  );
}
