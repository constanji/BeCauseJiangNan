import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type ReportOption = {
  taskId: string;
  endpointName?: string;
  model?: string;
  createdAt?: string;
  imported?: boolean;
};

function ImportBadge() {
  return (
    <span className="ml-1.5 inline-block shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-black/45">
      导入
    </span>
  );
}

function shortTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function groupByEndpoint(list: ReportOption[]) {
  const map = new Map<string, ReportOption[]>();
  for (const r of list) {
    const key = r.endpointName || '未命名端点';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()];
}

function ReportRow({
  r,
  selected,
  disabled,
  onPick,
}: {
  r: ReportOption;
  selected?: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${
        disabled
          ? 'cursor-not-allowed opacity-40'
          : selected
            ? 'bg-accent/10'
            : 'hover:bg-black/[0.04]'
      }`}
    >
      <span className="mt-0.5 w-4 shrink-0">
        {selected && <Check className="h-4 w-4 text-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate font-mono text-xs text-ink">{r.model || '—'}</span>
          {r.imported && <ImportBadge />}
        </span>
        <span className="mt-0.5 block text-[11px] text-black/45">{shortTime(r.createdAt)}</span>
      </span>
    </button>
  );
}

export default function ReportPicker({
  label,
  value,
  options,
  disabledId,
  onChange,
}: {
  label: string;
  value: string;
  options: ReportOption[];
  disabledId?: string;
  onChange: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((r) => r.taskId === value);
  const groups = useMemo(() => groupByEndpoint(options), [options]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative text-sm">
      <div className="mb-1 font-medium">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-black/15 bg-white px-3 py-2.5 text-left hover:border-black/25"
      >
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="flex items-center">
                <span className="truncate font-medium text-ink">
                  {selected.endpointName || '端点'}
                </span>
                {selected.imported && <ImportBadge />}
              </span>
              <span className="mt-0.5 block truncate font-mono text-xs text-black/55">
                {selected.model}
                {selected.createdAt ? ` · ${shortTime(selected.createdAt)}` : ''}
              </span>
            </>
          ) : (
            <span className="text-black/40">— 选择报告 —</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-black/40 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-black/10 bg-white py-2 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-lg px-2.5 py-2 text-left text-sm text-black/45 hover:bg-black/[0.04]"
          >
            清除选择
          </button>
          {groups.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-black/40">暂无可用的性能报告</div>
          ) : (
            groups.map(([endpoint, items]) => (
              <div key={endpoint} className="mb-1">
                <div className="sticky top-0 bg-white/95 px-3 py-1.5 text-[11px] font-medium tracking-wide text-black/40 backdrop-blur">
                  {endpoint}
                  <span className="ml-1 font-normal">({items.length})</span>
                </div>
                <div className="px-1.5">
                  {items.map((r) => (
                    <ReportRow
                      key={r.taskId}
                      r={r}
                      selected={r.taskId === value}
                      disabled={r.taskId === disabledId}
                      onPick={() => {
                        onChange(r.taskId);
                        setOpen(false);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
