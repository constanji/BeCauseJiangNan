import React from 'react';
import { Tag, TAG_COLORS } from '../lib/uiState';
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

  if (tags.length === 0) {
    return <p className="text-sm text-text-secondary">暂无标签，请先在「标签管理」创建。</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const active = value.includes(tag.id);
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
            aria-label={`${active ? '取消选择' : '选择'}标签 ${tag.name}`}
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
