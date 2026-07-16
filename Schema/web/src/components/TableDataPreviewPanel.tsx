import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { api } from '../api/client';
import { cn } from '../lib/cn';
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
import { highlightText } from '../lib/highlightText';

const DEBOUNCE_MS = 400;
const DISTINCT_LIMIT = 200;
const PREVIEW_ROW_LIMIT = 50;

function formatCell(value: unknown) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isCellEmpty(value: unknown) {
  if (value == null) return true;
  return String(value).trim() === '';
}

function getRowValue(row: Record<string, unknown>, column: string) {
  if (Object.prototype.hasOwnProperty.call(row, column)) return row[column];
  const lower = column.toLowerCase();
  const matchedKey = Object.keys(row).find((key) => key.toLowerCase() === lower);
  return matchedKey ? row[matchedKey] : undefined;
}

function computeVisibleColumns(
  allColumns: string[],
  rows: Record<string, unknown>[],
  hideEmptyColumns: boolean,
) {
  if (!hideEmptyColumns || rows.length === 0) return allColumns;
  return allColumns.filter((column) => (
    rows.some((row) => !isCellEmpty(getRowValue(row, column)))
  ));
}

function orderColumnsWithPriority(allColumns: string[], priorityColumns: string[]) {
  if (priorityColumns.length === 0) return allColumns;
  const prioritySet = new Set(priorityColumns);
  const first = priorityColumns.filter((col) => allColumns.includes(col));
  const rest = allColumns.filter((col) => !prioritySet.has(col));
  return [...first, ...rest];
}

function ColumnValuePicker({
  catalogId,
  remoteRef,
  column,
  open,
  anchorRect,
  onClose,
  onSelect,
}: {
  catalogId?: number;
  remoteRef?: { dataSourceId: string; schemaName: string; tableName: string };
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
    if (!remoteRef && catalogId != null) {
      const cached = loadCachedDistinctValues(catalogId, column);
      if (cached) {
        setPayload(cached);
        setLoading(false);
        return;
      }
    }
    setPayload(null);
    setLoading(true);
    const request = remoteRef
      ? api.previewRemoteDistinct(remoteRef.dataSourceId, remoteRef.schemaName, remoteRef.tableName, { column, limit: DISTINCT_LIMIT })
      : api.previewCatalogDistinct(catalogId!, { column, limit: DISTINCT_LIMIT });
    request
      .then((res) => {
        if (!res.success || !res.data) throw new Error(res.error || '加载可选值失败');
        setPayload(res.data);
        if (!remoteRef && catalogId != null) saveCachedDistinctValues(catalogId, res.data);
      })
      .catch((err) => setError(err?.message || String(err)))
      .finally(() => setLoading(false));
  }, [open, catalogId, remoteRef, column]);

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
  remoteRef,
  detail,
  open,
  onClose,
  variant = 'modal',
  initialFilters,
  highlightQuery = '',
  priorityColumns = [],
}: {
  catalogId?: number;
  remoteRef?: { dataSourceId: string; schemaName: string; tableName: string };
  detail: CatalogDetail;
  open: boolean;
  onClose?: () => void;
  variant?: 'modal' | 'inline';
  initialFilters?: Record<string, string>;
  /** 在命中列单元格内高亮关键词 */
  highlightQuery?: string;
  /** 优先展示并高亮的列（通常为搜索命中列） */
  priorityColumns?: string[];
}) {
  const parsed = parseLightSchemaContent(detail.content, detail.tableName);
  const columnNamesKey = React.useMemo(() => {
    const names = (parsed?.columns || []).map((col) => col.name);
    return `${detail.id}:${names.join('\x1e')}`;
  }, [detail.id, detail.content]);
  const columnNames = React.useMemo(() => {
    const sep = columnNamesKey.indexOf(':');
    if (sep < 0) return [];
    const raw = columnNamesKey.slice(sep + 1);
    return raw ? raw.split('\x1e') : [];
  }, [columnNamesKey]);
  const remoteRefKey = remoteRef
    ? `${remoteRef.dataSourceId}|${remoteRef.schemaName}|${remoteRef.tableName}`
    : '';
  const columnNamesRef = React.useRef(columnNames);
  columnNamesRef.current = columnNames;
  const columnDescriptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const col of parsed?.columns || []) {
      map.set(col.name, col.description || '');
    }
    return map;
  }, [parsed]);

  const [filtersByColumn, setFiltersByColumn] = React.useState<Record<string, string>>({});
  const [payload, setPayload] = React.useState<PreviewRowsPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [openPickerColumn, setOpenPickerColumn] = React.useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = React.useState<DOMRect | null>(null);
  const [dedupeColumn, setDedupeColumn] = React.useState<string | null>(null);
  const dedupeColumnRef = React.useRef<string | null>(null);
  dedupeColumnRef.current = dedupeColumn;
  const requestSeq = React.useRef(0);
  /** >0 时跳过筛选 effect；打开表时设为 2，避免挂载当次 + setFilters 再触发各打一遍请求 */
  const skipFilterEffect = React.useRef(0);
  const persistFilters = variant === 'modal' && !initialFilters;
  const initialFiltersKey = React.useMemo(
    () => JSON.stringify(initialFilters || {}),
    [initialFilters],
  );

  const fetchRows = React.useCallback(async (
    nextFilters: Record<string, string>,
    nextDedupeBy: string | null = dedupeColumnRef.current,
  ) => {
    const active = hasActiveFilters(nextFilters);
    const deduping = Boolean(nextDedupeBy);
    if (!remoteRef && catalogId != null && !active && !deduping) {
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
      const requestBody = {
        filters: filtersToRequest(nextFilters),
        limit: PREVIEW_ROW_LIMIT,
        dedupeBy: nextDedupeBy || undefined,
      };
      const res = remoteRef
        ? await api.previewRemoteRows(remoteRef.dataSourceId, remoteRef.schemaName, remoteRef.tableName, {
          columns: columnNamesRef.current,
          ...requestBody,
        })
        : await api.previewCatalogRows(catalogId!, requestBody);
      if (seq !== requestSeq.current) return;
      if (!res.success || !res.data) throw new Error(res.error || '加载数据失败');
      setPayload(res.data);
      if (!remoteRef && catalogId != null && !active && !deduping) {
        saveCachedPreviewRows(catalogId, res.data);
      }
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      setError(err?.message || String(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [catalogId, remoteRefKey]);

  // 打开/切换表时做首次加载；筛选项变化另走 debounce。
  // skip=2：同一轮挂载 effect 吃掉 1 次，setFilters 引发的再渲染再吃掉 1 次，避免连库打两遍。
  React.useEffect(() => {
    if (!open || columnNames.length === 0) return;
    skipFilterEffect.current = 2;
    const preset = initialFilters && Object.keys(initialFilters).length > 0
      ? initialFilters
      : null;
    const savedFilters = preset
      ?? ((!remoteRef && catalogId != null) ? loadSavedFilters(catalogId) : {});
    setFiltersByColumn(savedFilters);
    setPayload(null);
    setError(null);
    setOpenPickerColumn(null);
    setDedupeColumn(null);
    void fetchRows(savedFilters);
  }, [open, catalogId, remoteRefKey, columnNamesKey, initialFiltersKey, fetchRows]);

  React.useEffect(() => {
    if (!open) return;
    if (persistFilters && !remoteRef && catalogId != null) saveFilters(catalogId, filtersByColumn);
    if (skipFilterEffect.current > 0) {
      skipFilterEffect.current -= 1;
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchRows(filtersByColumn);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filtersByColumn, open, catalogId, remoteRefKey, fetchRows, persistFilters]);

  const openColumnPicker = (column: string, button: HTMLButtonElement) => {
    setOpenPickerColumn(column);
    setPickerAnchor(button.getBoundingClientRect());
  };

  const displayColumns = payload?.columns?.length ? payload.columns : columnNames;
  const rows = payload?.rows || [];
  const filtered = hasActiveFilters(filtersByColumn) || Boolean(payload?.filtered);
  const highlightQ = highlightQuery.trim();
  const highlightColumnSet = React.useMemo(
    () => new Set(priorityColumns.filter(Boolean)),
    [priorityColumns],
  );
  const visibleColumns = React.useMemo(() => {
    const base = computeVisibleColumns(displayColumns, rows, filtered);
    return orderColumnsWithPriority(base, priorityColumns);
  }, [displayColumns, rows, filtered, priorityColumns]);
  const hiddenEmptyColumnCount = filtered ? displayColumns.length - visibleColumns.length : 0;
  const tableMissingHint = error != null && (
    error.includes('不存在') || error.includes('LightSchema 可能已过期')
  );

  if (!open || !parsed) return null;

  const tableBlock = (
    <>
      {error && (
        <div className={cn('shrink-0', variant === 'modal' ? 'px-6 pt-4' : 'pb-3')}>
          <StatusBanner tone="error" title="加载失败" message={error} />
          {tableMissingHint && (
            <p className="mt-2 text-sm text-text-secondary">
              建议在工作台删除该表或重新生成 LightSchema。
            </p>
          )}
        </div>
      )}
      <div className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        variant === 'modal' && 'px-6 py-4',
      )}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-light">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto overscroll-y-contain">
            <table className="w-full min-w-max text-sm">
              <thead className="sticky top-0 z-10 bg-surface-secondary">
                <tr className="border-b border-border-light text-left text-text-secondary">
                  {visibleColumns.map((col) => {
                    const isHitColumn = highlightColumnSet.has(col);
                    return (
                    <th
                      key={col}
                      className={cn(
                        'whitespace-nowrap px-3 py-2 font-medium text-text-primary',
                        isHitColumn && 'bg-brand/10',
                      )}
                    >
                      <div className="flex items-center gap-1">
                        <span className="truncate">{col}</span>
                        {isHitColumn && (
                          <span className="shrink-0 rounded bg-brand/15 px-1 py-0.5 text-[10px] font-normal leading-none text-brand">
                            命中
                          </span>
                        )}
                        <button
                          type="button"
                          className={cn(
                            'shrink-0 rounded border px-1 py-0.5 text-[10px] leading-none transition-colors',
                            dedupeColumn === col
                              ? 'border-brand bg-brand/10 text-brand'
                              : 'border-border-light text-text-tertiary hover:border-border-medium hover:bg-surface-tertiary hover:text-text-primary',
                          )}
                          title={`按 ${col} 去重`}
                          aria-label={`按 ${col} 去重`}
                          onClick={() => {
                            const next = dedupeColumn === col ? null : col;
                            setDedupeColumn(next);
                            fetchRows(filtersByColumn, next);
                          }}
                        >
                          去重
                        </button>
                      </div>
                    </th>
                    );
                  })}
                </tr>
                <tr className="border-b border-border-light bg-surface-secondary text-left">
                  {visibleColumns.map((col) => {
                    const description = columnDescriptions.get(col) || '';
                    return (
                      <th key={`desc-${col}`} className="max-w-[12rem] px-3 py-1.5 font-normal">
                        {description ? (
                          <span
                            className="block truncate text-[11px] leading-snug text-text-tertiary"
                            title={description}
                          >
                            {description}
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-tertiary">—</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
                <tr className="border-b border-border-light bg-surface-primary">
                  {visibleColumns.map((col) => (
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
                    <td colSpan={visibleColumns.length || 1} className="px-3 py-8 text-center text-text-secondary">
                      加载中…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length || 1} className="px-3 py-8 text-center text-text-secondary">
                      {filtered || payload?.deduped ? '无匹配数据' : '暂无数据'}
                    </td>
                  </tr>
                ) : visibleColumns.length === 0 ? (
                  <tr>
                    <td colSpan={displayColumns.length || 1} className="px-3 py-8 text-center text-text-secondary">
                      筛选结果各列均为空
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-border-light hover:bg-surface-tertiary/30">
                      {visibleColumns.map((col) => {
                        const cellText = formatCell(getRowValue(row, col));
                        const isHitColumn = highlightColumnSet.has(col);
                        const shouldHighlight = isHitColumn && highlightQ.length > 0;
                        return (
                        <td
                          key={`${rowIndex}-${col}`}
                          className={cn(
                            'max-w-[16rem] truncate px-3 py-2 text-text-primary',
                            isHitColumn && 'bg-brand/5',
                          )}
                          title={cellText}
                        >
                          {shouldHighlight ? highlightText(cellText, highlightQ) : cellText}
                        </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-border-light px-4 py-3 text-xs text-text-secondary">
            <span>
              共返回 {rows.length} 行
              {payload?.deduped && payload.dedupeBy ? `（按 ${payload.dedupeBy} 去重）` : ''}
              {payload?.truncated ? `（最多 ${payload.limit} 行）` : ''}
            </span>
            <span>
              {filtered ? '已对全表筛选' : payload?.deduped ? '已对全表去重' : loading ? '加载中…' : `显示前 ${PREVIEW_ROW_LIMIT} 行`}
              {hiddenEmptyColumnCount > 0 ? ` · 已隐藏 ${hiddenEmptyColumnCount} 个空列` : ''}
            </span>
          </div>
        </div>
      </div>
      <ColumnValuePicker
        catalogId={catalogId}
        remoteRef={remoteRef}
        column={openPickerColumn || ''}
        open={openPickerColumn != null}
        anchorRect={pickerAnchor}
        onClose={() => setOpenPickerColumn(null)}
        onSelect={(value) => setFiltersByColumn((prev) => ({ ...prev, [openPickerColumn || '']: value }))}
      />
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tableBlock}
      </div>
    );
  }

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
              仅查询 LightSchema 中的 {columnNames.length} 列，最多返回 {PREVIEW_ROW_LIMIT} 行
            </p>
          </div>
          <Button variant="neutral" className="shrink-0 px-2 py-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {tableBlock}
      </div>
    </div>
  );
}
