import React from 'react';
import { createPortal } from 'react-dom';
import { Tag, TAG_COLORS } from '../lib/uiState';
import { sortTagsForPicker } from '../lib/tagDisplay';
import { cn } from '../lib/cn';
import TagBadge from './TagBadge';

export default function TagPicker({
  tags,
  value,
  onChange,
  multiple = true,
}: {
  tags: Tag[];
  value: number[];
  onChange: (ids: number[]) => void;
  multiple?: boolean;
}) {
  const toggle = (id: number) => {
    if (multiple) {
      onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    } else {
      onChange(value.includes(id) ? [] : [id]);
    }
  };

  const sortedTags = React.useMemo(() => sortTagsForPicker(tags), [tags]);

  if (sortedTags.length === 0) {
    return <p className="text-sm text-text-secondary">暂无标签，请先在「标签管理」创建。</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {sortedTags.map((tag) => {
        const active = value.includes(tag.id);
        const label = tag.displayName || tag.name;
        return (
          <button
            key={tag.id}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle(tag.id);
            }}
            className={cn(
              'inline-flex cursor-pointer border-0 bg-transparent p-0 transition-opacity',
              active ? 'opacity-100' : 'opacity-65 hover:opacity-100',
            )}
            aria-pressed={active ? 'true' : 'false'}
            aria-label={`${active ? '取消选择' : '选择'}标签 ${label}`}
          >
            <TagBadge tag={tag} selected={active} />
          </button>
        );
      })}
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={cn(
            'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
            value === color ? 'border-white' : 'border-transparent',
          )}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
          aria-label={`选择颜色 ${color}`}
        />
      ))}
    </div>
  );
}

export function ColorPickerPopover({
  value,
  onChange,
  label = '选择颜色',
  closeOnSelect = true,
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  closeOnSelect?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ top: 0, left: 0 });

  const updatePosition = React.useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = 220;
    const panelHeight = 88;
    let top = rect.bottom + 8;
    let left = rect.right - panelWidth;
    if (top + panelHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelHeight - 8);
    }
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    setPosition({ top, left });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-light bg-surface-secondary transition-colors hover:bg-surface-tertiary"
      >
        <span
          className="h-5 w-5 rounded-full border border-white/20"
          style={{ backgroundColor: value }}
        />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[200] w-[220px] rounded-lg border border-border-light bg-surface-secondary p-3 shadow-lg"
          style={{ top: position.top, left: position.left }}
        >
          <p className="mb-2 text-xs text-text-tertiary">{label}</p>
          <ColorPicker
            value={value}
            onChange={(next) => {
              onChange(next);
              if (closeOnSelect) setOpen(false);
            }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
