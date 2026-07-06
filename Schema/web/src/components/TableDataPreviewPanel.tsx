import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { api } from '../api/client';
import { CatalogDetail } from '../lib/uiState';
import { parseLightSchemaContent } from '../lib/lightSchemaTypes';
import {
  loadCachedDistinctValues,
  saveCachedDistinctValues,
  type DistinctValuesPayload,
} from '../lib/reviewTableDistinctCache';
import {
  filtersToRequest,
  hasActiveFilters,
  loadCachedPreviewRows,
  loadSavedFilters,
  saveCachedPreviewRows,
  saveFilters,
  type PreviewRowsPayload,
} from '../lib/reviewTableDataCache';
import Button from './Button';
import StatusBanner from './StatusBanner';

const DEBOUNCE_MS = 400;
const DISTINCT_LIMIT = 200;

function formatCell(value: unknown) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function ColumnValuePicker({
  catalogId,
  column,
  open,
  anchorRect,
  onClose,
  onSelect,
}: {
  catalogId: number;
  column: string;
  open: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const [payload, setPayload] = React.useState<DistinctValuesPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setSearch('');
    setError(null);
    const cached = loadCachedDistinctValues(catalogId, column);
    if (cached) {
      setPayload(cached);
      setLoading(false);
      return;
    }
    setPayload(null);
    setLoading(true);
    api.previewCatalogDistinct(catalogId, { column, limit: DISTINCT_LIMIT })
      .then((res) => {
        if (!res.success || !res.data) throw new Error(res.error || '加载可选值失败');
        setPayload(res.data);
        saveCachedDistinctValues(catalogId, res.data);
      })
      .catch((err) => setError(err?.message || String(err)))
      .finally(() => setLoading(false));
  }, [open, catalogId, column]);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !anchorRect || typeof document === 'undefined') return null;

  const values = payload?.values || [];
  const needle = search.trim().toLowerCase();
  const filteredValues = needle
    ? values.filter((value) => value.toLowerCase().includes(needle))
    : values;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const panelWidth = 280;
  const panelMaxHeight = 320;
  let left = anchorRect.right - panelWidth;
  let top = anchorRect.bottom + 4;
  if (left < 8) left = 8;
  if (left + panelWidth > viewportWidth - 8) left = viewportWidth - panelWidth - 8;
  if (top + panelMaxHeight > viewportHeight - 8) {
    top = Math.max(8, anchorRect.top - panelMaxHeight - 4);
  }

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-border-light bg-surface-primary shadow-xl"
      style={{ left, top, width: panelWidth, maxHeight: panelMaxHeight }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-border-light px-3 py-2">
        <span className="truncate text-xs font-medium text-text-primary">选择 {column}</span>
        <button
          type="button"
          className="rounded p-1 text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary"
          aria-label="关闭"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="border-b border-border-light px-3 py-2">
        <input
          className="input w-full py-1 text-xs"
          placeholder="搜索可选值"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-1">
        {loading ? (
          <div className="px-3 py-6 text-center text-xs text-text-secondary">加载中…</div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-red-400">{error}</div>
        ) : filteredValues.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-text-secondary">无可选值</div>
        ) : (
          filteredValues.map((value) => (
            <button
              key={value}
              type="button"
              className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-tertiary"
              title={value}
              onClick={() => {
                onSelect(value);
                onClose();
              }}
            >
              {value}
            </button>
          ))
        )}
      </div>
      {payload?.truncated && (
        <div className="border-t border-border-light px-3 py-2 text-[11px] text-text-tertiary">
          仅显示前 {payload.limit} 个不重复值
        </div>
      )}
    </div>,
    document.body,
  );
}

export default function TableDataPreviewPanel({
  catalogId,
  detail,
  open,
  onClose,
}: {
  catalogId: number;
  detail: CatalogDetail;
  open: boolean;
  onClose: () => void;
}) {
  const parsed = parseLightSchemaContent(detail.content, detail.tableName);
  const columnNames = React.useMemo(
    () => (parsed?.columns || []).map((col) => col.name),
    [parsed],
  );

  const [filtersByColumn, setFiltersByColumn] = React.useState<Record<string, string>>({});
  const [payload, setPayload] = React.useState<PreviewRowsPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [openPickerColumn, setOpenPickerColumn] = React.useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = React.useState<DOMRect | null>(null);
  const requestSeq = React.useRef(0);
  const skipFilterEffect = React.useRef(true);

  const fetchRows = React.useCallback(async (nextFilters: Record<string, string>) => {
    const active = hasActiveFilters(nextFilters);
    if (!active) {
      const cached = loadCachedPreviewRows(catalogId);
      if (cached) {
        setPayload(cached);
        setError(null);
        setLoading(false);
        return;
      }
    }

    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.previewCatalogRows(catalogId, {
        filters: filtersToRequest(nextFilters),
        limit: 100,
      });
      if (seq !== requestSeq.current) return;
      if (!res.success || !res.data) throw new Error(res.error || '加载数据失败');
      setPayload(res.data);
      if (!active) saveCachedPreviewRows(catalogId, res.data);
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      setError(err?.message || String(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [catalogId]);

  React.useEffect(() => {
    if (!open || columnNames.length === 0) return;
    skipFilterEffect.current = true;
    const savedFilters = loadSavedFilters(catalogId);
    setFiltersByColumn(savedFilters);
    setPayload(null);
    setError(null);
    setOpenPickerColumn(null);
    fetchRows(savedFilters);
  }, [open, catalogId, columnNames.length, fetchRows]);

  React.useEffect(() => {
    if (!open) return;
    saveFilters(catalogId, filtersByColumn);
    if (skipFilterEffect.current) {
      skipFilterEffect.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      fetchRows(filtersByColumn);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, catalogId, filtersByColumn, fetchRows]);

  const openColumnPicker = (column: string, button: HTMLButtonElement) => {
    setOpenPickerColumn(column);
    setPickerAnchor(button.getBoundingClientRect());
  };

  if (!open || !parsed) return null;

  const displayColumns = payload?.columns?.length ? payload.columns : columnNames;
  const rows = payload?.rows || [];
  const filtered = hasActiveFilters(filtersByColumn);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-border-light bg-surface-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-light px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-text-primary">查看数据</h3>
            <p className="mt-1 truncate text-sm text-text-secondary">
              {detail.dataSourceName} / {detail.schemaName}.{detail.tableName}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              仅查询 LightSchema 中的 {columnNames.length} 列，最多返回 100 行
            </p>
          </div>
          <Button variant="neutral" className="shrink-0 px-2 py-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {error && (
          <div className="shrink-0 px-6 pt-4">
            <StatusBanner tone="error" title="加载失败" message={error} />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-light">
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto overscroll-y-contain">
              <table className="w-full min-w-max text-sm">
                <thead className="sticky top-0 z-10 bg-surface-secondary">
                  <tr className="border-b border-border-light text-left text-text-secondary">
                    {displayColumns.map((col) => (
                      <th key={col} className="whitespace-nowrap px-3 py-2 font-medium">{col}</th>
                    ))}
                  </tr>
                  <tr className="border-b border-border-light bg-surface-primary">
                    {displayColumns.map((col) => (
                      <th key={`filter-${col}`} className="px-3 py-2">
                        <div className="flex min-w-[8rem] items-center gap-1">
                          <input
                            className="input min-w-0 flex-1 py-1 text-xs"
                            placeholder={`筛选 ${col}`}
                            value={filtersByColumn[col] || ''}
                            onChange={(e) => setFiltersByColumn((prev) => ({
                              ...prev,
                              [col]: e.target.value,
                            }))}
                          />
                          <button
                            type="button"
                            className="shrink-0 rounded border border-border-light bg-surface-secondary p-1 text-text-secondary hover:border-border-medium hover:bg-surface-tertiary hover:text-text-primary"
                            title={`选择 ${col} 的可选值`}
                            aria-label={`选择 ${col} 的可选值`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openColumnPicker(col, e.currentTarget);
                            }}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    <tr>
                      <td colSpan={displayColumns.length} className="px-3 py-8 text-center text-text-secondary">
                        加载中…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={displayColumns.length} className="px-3 py-8 text-center text-text-secondary">
                        {filtered ? '无匹配数据' : '暂无数据'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-border-light hover:bg-surface-tertiary/30">
                        {displayColumns.map((col) => (
                          <td
                            key={`${rowIndex}-${col}`}
                            className="max-w-[16rem] truncate px-3 py-2 text-text-primary"
                            title={formatCell(row[col])}
                          >
                            {formatCell(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-border-light px-4 py-3 text-xs text-text-secondary">
              <span>
                共返回 {rows.length} 行
                {payload?.truncated ? `（最多 ${payload.limit} 行）` : ''}
              </span>
              <span>
                {filtered ? '已对全表筛选' : loading ? '加载中…' : '显示前 100 行'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <ColumnValuePicker
        catalogId={catalogId}
        column={openPickerColumn || ''}
        open={openPickerColumn != null}
        anchorRect={pickerAnchor}
        onClose={() => setOpenPickerColumn(null)}
        onSelect={(value) => setFiltersByColumn((prev) => ({ ...prev, [openPickerColumn || '']: value }))}
      />
    </div>
  );
}
