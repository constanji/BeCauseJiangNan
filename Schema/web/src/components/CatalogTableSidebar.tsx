import React from 'react';
import { Search, X } from 'lucide-react';

export default function CatalogTableSidebar({
  tableSearch,
  onTableSearchChange,
  loading = false,
  emptyMessage,
  footer,
  children,
}: {
  tableSearch: string;
  onTableSearchChange: (value: string) => void;
  loading?: boolean;
  emptyMessage?: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border-light bg-surface-secondary">
      <div className="shrink-0 border-b border-border-light p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
          <input
            className="input py-2 pl-8 pr-8 text-sm"
            placeholder="搜索表名…"
            value={tableSearch}
            onChange={(e) => onTableSearchChange(e.target.value)}
          />
          {tableSearch && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
              onClick={() => onTableSearchChange('')}
              aria-label="清空搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="py-8 text-center text-sm text-text-secondary">加载中…</div>
        ) : emptyMessage != null ? (
          emptyMessage
        ) : (
          children
        )}
      </div>
      <div className="flex min-h-[3rem] shrink-0 items-center border-t border-border-light px-4 py-3 text-xs text-text-tertiary">
        {footer}
      </div>
    </aside>
  );
}
