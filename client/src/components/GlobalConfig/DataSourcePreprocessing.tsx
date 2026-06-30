import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Layers,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Search,
  X,
  ChevronDown,
  Key,
  Database,
  Trash2,
  Pencil,
  Save,
  XCircle,
} from 'lucide-react';
import { useToastContext } from '@because/client';
import { dataService } from '@because/data-provider';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LightSchemaEntry {
  tableName: string;
  createdAt: string;
  content: string;
  ddlText: string;
}

interface DatabaseSchemaInfo {
  schemaName: string;
  tableCount: number | null;
}

interface LightSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  description?: string;
  sampleValues?: string[];
}

interface LightSchemaParsed {
  tableName: string;
  columns: LightSchemaColumn[];
  primaryKeys: string[];
}

interface CellVectorEntry {
  id: number;
  tableName: string;
  columnName: string;
  cellValue: string;
  createdAt: string;
}

interface ColumnCellSummary {
  key: string;
  tableName: string;
  columnName: string;
  description: string;
  columnType: string;
  values: CellVectorEntry[];
  distinctCount: number;
  preview: string;
}

function buildColumnMetaMap(schemas: LightSchemaEntry[]): Map<string, { description: string; type: string }> {
  const map = new Map<string, { description: string; type: string }>();
  for (const schema of schemas) {
    try {
      const parsed = JSON.parse(schema.content) as LightSchemaParsed;
      for (const col of parsed.columns || []) {
        map.set(`${schema.tableName}::${col.name}`, {
          description: col.description?.trim() || '',
          type: col.type?.trim() || '',
        });
      }
    } catch (_) {
      // ignore malformed schema
    }
  }
  return map;
}

function buildColumnSummaries(entries: CellVectorEntry[], metaMap: Map<string, { description: string; type: string }>): ColumnCellSummary[] {
  const grouped = new Map<string, CellVectorEntry[]>();
  for (const entry of entries) {
    const key = `${entry.tableName}::${entry.columnName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  const summaries: ColumnCellSummary[] = [];
  for (const [key, values] of grouped) {
    values.sort((a, b) => a.cellValue.localeCompare(b.cellValue, 'zh-CN'));
    const [tableName, columnName] = key.split('::');
    const meta = metaMap.get(key);
    const previewLimit = 4;
    const previewParts = values.slice(0, previewLimit).map((v) => v.cellValue);
    const preview =
      values.length > previewLimit
        ? `${previewParts.join(' / ')} … (+${values.length - previewLimit})`
        : previewParts.join(' / ');

    summaries.push({
      key,
      tableName,
      columnName,
      description: meta?.description || '',
      columnType: meta?.type || '',
      values,
      distinctCount: values.length,
      preview,
    });
  }

  return summaries.sort((a, b) => {
    const t = a.tableName.localeCompare(b.tableName, 'zh-CN');
    return t !== 0 ? t : a.columnName.localeCompare(b.columnName, 'zh-CN');
  });
}

interface TableCellGroup {
  tableName: string;
  columns: ColumnCellSummary[];
  valueCount: number;
}

function buildTableGroups(rows: ColumnCellSummary[]): TableCellGroup[] {
  const map = new Map<string, ColumnCellSummary[]>();
  for (const row of rows) {
    if (!map.has(row.tableName)) map.set(row.tableName, []);
    map.get(row.tableName)!.push(row);
  }

  return [...map.entries()]
    .map(([tableName, columns]) => ({
      tableName,
      columns,
      valueCount: columns.reduce((sum, col) => sum + col.distinctCount, 0),
    }))
    .sort((a, b) => a.tableName.localeCompare(b.tableName, 'zh-CN'));
}

function orderedSchemaTableNames(schemas: LightSchemaEntry[], search: string): string[] {
  const q = search.trim().toLowerCase();
  return schemas
    .filter((s) => !q || s.tableName.toLowerCase().includes(q))
    .map((s) => s.tableName);
}

function pickNextTableName(tableNames: string[], removed: string): string {
  const idx = tableNames.indexOf(removed);
  const remaining = tableNames.filter((n) => n !== removed);
  if (remaining.length === 0) return '';
  if (idx === -1) return remaining[0] ?? '';
  return remaining[Math.min(idx, remaining.length - 1)] ?? '';
}

// ─── TablePickerModal ─────────────────────────────────────────────────────────

function TablePickerModal({
  allTables,
  selected,
  onConfirm,
  onClose,
  cachedTables,
  title = '选择表',
  // preferCached=true 时：已 cached 的表排前面并默认选中（Cell 向量化模式）
  // preferCached=false 时：未 cached 的表排前面并默认选中（Light Schema 增量模式）
  preferCached = false,
  cachedGroupLabel,
  uncachedGroupLabel,
}: {
  allTables: string[];
  selected: Set<string>;
  onConfirm: (next: Set<string>) => void;
  onClose: () => void;
  cachedTables: Set<string>;
  title?: string;
  preferCached?: boolean;
  cachedGroupLabel?: string;
  uncachedGroupLabel?: string;
}) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(new Set(selected));
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const filtered = allTables.filter((t) =>
    t.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredCached = filtered.filter((t) => cachedTables.has(t));
  const filteredUncached = filtered.filter((t) => !cachedTables.has(t));

  // 分组顺序
  const groupA = preferCached ? filteredCached : filteredUncached;
  const groupB = preferCached ? filteredUncached : filteredCached;
  const groupALabel = preferCached
    ? (cachedGroupLabel ?? `已生成 Light Schema (${filteredCached.length})`)
    : (uncachedGroupLabel ?? `未生成 (${filteredUncached.length})`);
  const groupBLabel = preferCached
    ? (uncachedGroupLabel ?? `未生成 Light Schema (${filteredUncached.length})`)
    : (cachedGroupLabel ?? `已生成 (${filteredCached.length})`);
  const groupAColor = preferCached ? 'text-green-500/80' : 'text-text-secondary/50';
  const groupBColor = preferCached ? 'text-text-secondary/50' : 'text-green-500/80';

  const allFilteredChecked = filtered.length > 0 && filtered.every((t) => draft.has(t));
  const someFilteredChecked = filtered.some((t) => draft.has(t));

  // 快捷：Schema 模式（增量/全量），Cell 模式（只选有 Schema 的/全选）
  const cachedAll = allTables.filter((t) => cachedTables.has(t));
  const uncachedAll = allTables.filter((t) => !cachedTables.has(t));

  const quickA = () => {
    if (preferCached) {
      // Cell 模式：只选有 Light Schema 的表
      setDraft(new Set(cachedAll.length > 0 ? cachedAll : allTables));
    } else {
      // Schema 模式：增量（只选未生成的）
      setDraft(new Set(uncachedAll.length > 0 ? uncachedAll : allTables));
    }
  };
  const quickB = () => setDraft(new Set(allTables));

  const toggleOne = (name: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleFiltered = () => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) filtered.forEach((t) => next.delete(t));
      else filtered.forEach((t) => next.add(t));
      return next;
    });
  };

  const TableRow = ({ name }: { name: string }) => {
    const isCached = cachedTables.has(name);
    const isPreferred = preferCached ? isCached : !isCached;
    return (
      <label className="flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-hover group">
        <input
          type="checkbox"
          checked={draft.has(name)}
          onChange={() => toggleOne(name)}
          className="h-4 w-4 shrink-0 cursor-pointer accent-green-500"
          aria-label={name}
        />
        <span
          className={`truncate text-sm transition-colors ${
            isPreferred
              ? 'text-green-300 group-hover:text-green-200'
              : 'text-text-primary group-hover:text-green-400'
          }`}
          title={name}
        >
          {name}
        </span>
        {isCached && (
          <span title={preferCached ? '已有 Light Schema' : '已生成 Light Schema'}>
            <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500 ml-auto" />
          </span>
        )}
      </label>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="flex w-[440px] max-h-[82vh] flex-col rounded-xl border border-border-light bg-surface-primary shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3 shrink-0">
          <div>
            <span className="font-semibold text-text-primary">{title}</span>
            <span className="ml-2 text-xs text-text-secondary">
              已选 {draft.size} / {allTables.length}
            </span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 快捷模式按钮 */}
        {cachedTables.size > 0 && (
          <div className="flex items-center gap-2 border-b border-border-light bg-surface-secondary px-4 py-2.5 shrink-0">
            <span className="text-xs text-text-secondary mr-1">快捷：</span>
            <button
              onClick={quickA}
              className="rounded-md border border-green-700/40 bg-green-900/20 px-2.5 py-1 text-xs text-green-300 hover:border-green-500 hover:bg-green-800/30 transition-colors"
            >
              {preferCached
                ? `只选已有 Schema (${cachedAll.length})`
                : `增量更新 (${uncachedAll.length})`}
            </button>
            <button
              onClick={quickB}
              className="rounded-md border border-border-light bg-surface-primary px-2.5 py-1 text-xs text-text-secondary hover:border-green-500 hover:text-green-400 transition-colors"
            >
              全选 ({allTables.length})
            </button>
          </div>
        )}

        {/* 搜索框 */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索表名…"
              aria-label="搜索表名"
              className="w-full rounded-lg border border-border-light bg-surface-secondary py-1.5 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary" aria-label="清空">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 全选行 */}
        {filtered.length > 0 && (
          <label className="flex cursor-pointer select-none items-center gap-2 border-b border-border-light px-4 py-2 hover:bg-surface-hover shrink-0">
            <input
              type="checkbox"
              checked={allFilteredChecked}
              ref={(el) => { if (el) el.indeterminate = someFilteredChecked && !allFilteredChecked; }}
              onChange={toggleFiltered}
              className="h-4 w-4 cursor-pointer accent-green-500"
              aria-label="全选"
            />
            <span className="text-sm font-medium text-text-primary">
              {search ? `全选搜索结果 (${filtered.length})` : '全选'}
            </span>
          </label>
        )}

        {/* 表列表（分组） */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-secondary">无匹配表名</p>
          ) : (
            <>
              {/* A 组（优先组） */}
              {groupA.length > 0 && (
                <div className="mb-1">
                  {cachedTables.size > 0 && (
                    <div className={`px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider ${groupAColor}`}>
                      {groupALabel}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-1">
                    {groupA.map((name) => <TableRow key={name} name={name} />)}
                  </div>
                </div>
              )}
              {/* B 组 */}
              {groupB.length > 0 && (
                <div className={groupA.length > 0 ? 'mt-2 border-t border-border-light/50 pt-2' : ''}>
                  <div className={`px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider ${groupBColor}`}>
                    {groupBLabel}
                  </div>
                  <div className="grid grid-cols-2 gap-x-1">
                    {groupB.map((name) => <TableRow key={name} name={name} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 border-t border-border-light px-4 py-3 shrink-0">
          <button onClick={onClose} className="rounded-lg border border-border-light px-4 py-1.5 text-sm text-text-secondary hover:bg-surface-hover transition-colors">
            取消
          </button>
          <button
            onClick={() => { onConfirm(draft); onClose(); }}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 transition-colors"
          >
            确认 ({draft.size})
          </button>
        </div>
      </div>
    </div>
  );
}

// 根据列类型返回颜色样式
function typeStyle(type: string): string {
  const t = type.toLowerCase();
  if (/^int|bigint|smallint|tinyint|serial/.test(t)) return 'text-blue-400 bg-blue-900/20 border-blue-700/30';
  if (/^varchar|char|text|enum|string/.test(t)) return 'text-purple-400 bg-purple-900/20 border-purple-700/30';
  if (/^float|double|decimal|numeric/.test(t)) return 'text-cyan-400 bg-cyan-900/20 border-cyan-700/30';
  if (/^date|time|timestamp/.test(t)) return 'text-orange-400 bg-orange-900/20 border-orange-700/30';
  if (/^bool/.test(t)) return 'text-pink-400 bg-pink-900/20 border-pink-700/30';
  return 'text-green-400 bg-green-900/20 border-green-700/30';
}

// ─── SchemaViewer（内嵌双面板子视图）────────────────────────────────────────────

/** 列编辑草稿：仅允许改注释和采样值 */
interface ColDraft {
  description: string;
  sampleValues: string;
}

function blankDraft(): ColDraft {
  return { description: '', sampleValues: '' };
}

function parsedToColDraft(col: LightSchemaColumn): ColDraft {
  return {
    description: col.description ?? '',
    sampleValues: (col.sampleValues ?? []).join(', '),
  };
}

function CellVectorViewer({
  entries,
  schemas,
  loading,
  saving,
  initialSelectedTable,
  onBack,
  onRefresh,
  onCreate,
  onUpdate,
  onDelete,
  onDeleteTable,
}: {
  entries: CellVectorEntry[];
  schemas: LightSchemaEntry[];
  loading: boolean;
  saving: boolean;
  initialSelectedTable?: string;
  onBack: () => void;
  onRefresh: () => void;
  onCreate: (payload: { tableName: string; columnName: string; cellValue: string }) => Promise<boolean>;
  onUpdate: (id: number, payload: { tableName: string; columnName: string; cellValue: string }) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
  onDeleteTable: (tableName: string) => Promise<boolean>;
}) {
  const [search, setSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [draft, setDraft] = useState({ tableName: '', columnName: '', cellValue: '' });
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panelSearch, setPanelSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState({ tableName: '', columnName: '', cellValue: '' });
  const [panelAddValue, setPanelAddValue] = useState('');
  const [deletingTable, setDeletingTable] = useState<string | null>(null);

  const columnMeta = buildColumnMetaMap(schemas);

  const filteredEntries = entries.filter((entry) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const meta = columnMeta.get(`${entry.tableName}::${entry.columnName}`);
    return (
      entry.tableName.toLowerCase().includes(q) ||
      entry.columnName.toLowerCase().includes(q) ||
      entry.cellValue.toLowerCase().includes(q) ||
      (meta?.description || '').toLowerCase().includes(q) ||
      (meta?.type || '').toLowerCase().includes(q)
    );
  });

  const columnRows = buildColumnSummaries(filteredEntries, columnMeta);
  const tableGroups = useMemo(() => buildTableGroups(columnRows), [columnRows]);
  const activeTable =
    selectedTable && tableGroups.some((g) => g.tableName === selectedTable)
      ? selectedTable
      : tableGroups[0]?.tableName ?? null;
  const activeGroup = tableGroups.find((g) => g.tableName === activeTable) ?? null;
  const visibleColumns = activeGroup?.columns ?? [];
  const selectedSummary = selectedKey ? columnRows.find((r) => r.key === selectedKey) ?? null : null;
  const filteredTableGroups = tableGroups.filter(
    (g) => !tableSearch.trim() || g.tableName.toLowerCase().includes(tableSearch.trim().toLowerCase()),
  );

  const initialAppliedRef = useRef(false);
  useEffect(() => {
    initialAppliedRef.current = false;
  }, [initialSelectedTable]);

  useEffect(() => {
    if (initialAppliedRef.current || tableGroups.length === 0) return;
    if (initialSelectedTable && tableGroups.some((g) => g.tableName === initialSelectedTable)) {
      setSelectedTable(initialSelectedTable);
    } else {
      setSelectedTable((prev) => prev ?? tableGroups[0]?.tableName ?? null);
    }
    initialAppliedRef.current = true;
  }, [initialSelectedTable, tableGroups]);

  // 过滤后当前表不存在时，顺延回退（有 tableSearch 时在筛选结果内顺延）
  useEffect(() => {
    if (tableGroups.length === 0) {
      setSelectedTable(null);
      return;
    }
    if (selectedTable && tableGroups.some((g) => g.tableName === selectedTable)) return;

    const q = tableSearch.trim().toLowerCase();
    const ordered = tableGroups
      .filter((g) => !q || g.tableName.toLowerCase().includes(q))
      .map((g) => g.tableName);
    setSelectedTable(ordered[0] ?? tableGroups[0].tableName);
  }, [tableGroups, selectedTable, tableSearch]);

  // 选中列时同步当前表
  useEffect(() => {
    if (!selectedKey) return;
    const row = columnRows.find((r) => r.key === selectedKey);
    if (row) setSelectedTable(row.tableName);
  }, [selectedKey, columnRows]);

  // 当前选中列被过滤掉时关闭面板
  useEffect(() => {
    if (selectedKey && !columnRows.some((r) => r.key === selectedKey)) {
      setSelectedKey(null);
    }
  }, [selectedKey, columnRows]);

  // 搜索命中时自动定位表/列（默认收起，搜索直达）
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) return;

    const valueHit = columnRows.find((row) =>
      row.values.some((v) => v.cellValue.toLowerCase().includes(q)),
    );
    if (valueHit) {
      setSelectedTable(valueHit.tableName);
      setSelectedKey(valueHit.key);
      return;
    }

    const columnHit = columnRows.find(
      (row) =>
        row.columnName.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q),
    );
    if (columnHit) {
      setSelectedTable(columnHit.tableName);
      return;
    }

    const tableHit = tableGroups.find((g) => g.tableName.toLowerCase().includes(q));
    if (tableHit) setSelectedTable(tableHit.tableName);
  }, [search, columnRows, tableGroups]);

  useEffect(() => {
    setPanelSearch('');
    setEditingId(null);
    setPanelAddValue('');
  }, [selectedKey]);

  const resetCreateDraft = () => setDraft({ tableName: '', columnName: '', cellValue: '' });

  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    if (selectedKey) {
      const row = columnRows.find((r) => r.key === selectedKey);
      if (row?.tableName !== tableName) setSelectedKey(null);
    }
  };

  const handleDeleteTable = async (tableName: string) => {
    if (!window.confirm(`确定删除「${tableName}」的全部 Cell 向量吗？此操作无法撤销。`)) return;
    const q = tableSearch.trim().toLowerCase();
    const ordered = tableGroups
      .filter((g) => !q || g.tableName.toLowerCase().includes(q))
      .map((g) => g.tableName);
    const nextTable = pickNextTableName(ordered, tableName);
    setDeletingTable(tableName);
    try {
      const ok = await onDeleteTable(tableName);
      if (!ok) return;
      if (activeTable === tableName) {
        setSelectedTable(nextTable || null);
        setSelectedKey(null);
      }
    } finally {
      setDeletingTable(null);
    }
  };

  const tableCount = tableGroups.length;
  const totalValues = filteredEntries.length;

  const panelFilteredValues = selectedSummary
    ? selectedSummary.values.filter((v) => {
        const q = panelSearch.trim().toLowerCase();
        if (!q) return true;
        return v.cellValue.toLowerCase().includes(q);
      })
    : [];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-primary">
      {/* 顶部导航栏 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-light bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))] px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-border-light/70 bg-surface-primary/70 px-3 py-2 text-sm text-text-secondary hover:border-green-500/40 hover:bg-surface-hover hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回
          </button>
          <div className="h-8 w-px bg-border-light/70" />
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-green-500/20 bg-green-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.06)]">
              <Sparkles className="h-4 w-4 text-green-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-green-500/70">Cell Vector Browser</div>
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-primary">单元格向量预览</span>
                <span className="rounded-full border border-green-700/30 bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
                  {tableCount} 张表
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索表 / 列 / 注释 / 值…"
              aria-label="搜索单元格向量结果"
              className="w-56 rounded-lg border border-border-light bg-surface-primary py-1.5 pl-8 pr-3 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-border-light bg-surface-primary/60 px-2.5 py-1.5 text-xs text-text-secondary hover:text-green-400 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <span className="hidden rounded-full border border-border-light bg-surface-primary/60 px-2.5 py-1 text-[11px] text-text-secondary lg:inline">
            {columnRows.length} 字段 · {totalValues} 值
          </span>
        </div>
      </div>

      {/* 快捷新增 */}
      <div className="grid shrink-0 gap-2 border-b border-border-light bg-surface-secondary/40 px-5 py-3 md:grid-cols-[1fr_1fr_2fr_auto]">
        <input
          type="text"
          value={draft.tableName}
          onChange={(e) => setDraft((prev) => ({ ...prev, tableName: e.target.value }))}
          placeholder="表名"
          aria-label="新增单元格向量表名"
          className="rounded-md border border-border-light bg-surface-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <input
          type="text"
          value={draft.columnName}
          onChange={(e) => setDraft((prev) => ({ ...prev, columnName: e.target.value }))}
          placeholder="列名"
          aria-label="新增单元格向量列名"
          className="rounded-md border border-border-light bg-surface-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <input
          type="text"
          value={draft.cellValue}
          onChange={(e) => setDraft((prev) => ({ ...prev, cellValue: e.target.value }))}
          placeholder="单元格值"
          aria-label="新增单元格向量值"
          className="rounded-md border border-border-light bg-surface-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <button
          onClick={async () => {
            const ok = await onCreate(draft);
            if (ok) resetCreateDraft();
          }}
          disabled={saving}
          className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          新增
        </button>
      </div>

      {/* 双面板主体：表 | 列 + 值 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧表列表 */}
        <div className="flex w-52 shrink-0 flex-col overflow-hidden border-r border-border-light bg-surface-secondary">
          <div className="shrink-0 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="搜索表名…"
                aria-label="搜索表名"
                className="w-full rounded-lg border border-border-light bg-surface-primary py-1.5 pl-8 pr-7 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              {tableSearch && (
                <button
                  onClick={() => setTableSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  aria-label="清空"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-xs text-text-secondary">
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                加载中…
              </div>
            ) : filteredTableGroups.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-text-secondary">无匹配表</p>
            ) : (
              <ul>
                {filteredTableGroups.map((group) => {
                  const isActive = activeTable === group.tableName;
                  return (
                    <li key={group.tableName} className="group flex items-stretch">
                      <button
                        type="button"
                        onClick={() => handleSelectTable(group.tableName)}
                        className={`min-w-0 flex-1 border-l-[3px] px-4 py-3 text-left transition-all ${
                          isActive
                            ? 'border-l-green-500 bg-green-900/25 text-green-300'
                            : 'border-l-transparent text-text-primary hover:border-l-border-light hover:bg-surface-hover'
                        }`}
                      >
                        <div className={`truncate font-mono text-xs font-medium ${isActive ? 'text-green-300' : 'text-text-primary'}`} title={group.tableName}>
                          {group.tableName}
                        </div>
                        <div className={`mt-0.5 text-[11px] ${isActive ? 'text-green-500/70' : 'text-text-secondary'}`}>
                          {group.columns.length} 列 · {group.valueCount} 值
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTable(group.tableName);
                        }}
                        disabled={deletingTable === group.tableName}
                        title={`删除 ${group.tableName}`}
                        aria-label={`删除 ${group.tableName}`}
                        className={`flex w-9 shrink-0 items-center justify-center transition-colors ${
                          isActive
                            ? 'text-red-400/70 hover:bg-red-900/20 hover:text-red-400'
                            : 'text-text-secondary/40 opacity-0 hover:bg-red-900/10 hover:text-red-400 group-hover:opacity-100'
                        } disabled:opacity-50`}
                      >
                        {deletingTable === group.tableName
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 右侧：列列表 + 值详情 */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className={`flex min-h-0 min-w-0 flex-col ${selectedSummary ? 'flex-1 border-r border-border-light' : 'w-full'}`}>
            <div className="flex shrink-0 items-center justify-between border-b border-border-light bg-surface-secondary/60 px-4 py-2.5">
              <span className="truncate text-sm font-medium text-text-primary" title={activeTable ?? undefined}>
                {activeTable ? `列 · ${activeTable}` : '列'}
              </span>
              {activeGroup && (
                <span className="shrink-0 text-[11px] text-text-secondary">{activeGroup.columns.length} 字段</span>
              )}
            </div>

            <div className="grid shrink-0 grid-cols-[minmax(88px,0.9fr)_minmax(100px,1fr)_minmax(140px,1.6fr)_56px] gap-2 border-b border-border-light bg-surface-secondary/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              <span>列名</span>
              <span>注释</span>
              <span>值摘要</span>
              <span className="text-right">操作</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-sm text-text-secondary">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载中…
                </div>
              ) : columnRows.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-secondary">暂无匹配的 Cell 向量记录</div>
              ) : !activeTable ? (
                <div className="flex h-full items-center justify-center py-12 text-sm text-text-secondary">从左侧选择一张表</div>
              ) : visibleColumns.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-secondary">当前表无匹配字段</div>
              ) : (
                visibleColumns.map((row) => {
                  const isSelected = selectedKey === row.key;
                  const q = search.trim().toLowerCase();
                  const valueHit = q ? row.values.some((v) => v.cellValue.toLowerCase().includes(q)) : false;

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => setSelectedKey(isSelected ? null : row.key)}
                      className={`grid w-full grid-cols-[minmax(88px,0.9fr)_minmax(100px,1fr)_minmax(140px,1.6fr)_56px] gap-2 border-b border-border-light/60 px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover/70 ${
                        isSelected ? 'bg-green-900/15 ring-1 ring-inset ring-green-700/30' : ''
                      }`}
                    >
                      <span className="truncate font-medium text-text-primary" title={row.columnName}>
                        {row.columnName}
                      </span>
                      <span
                        className={`truncate text-xs ${row.description ? 'text-text-secondary' : 'text-text-secondary/40'}`}
                        title={row.description || '无列注释'}
                      >
                        {row.description || '—'}
                      </span>
                      <span className="min-w-0 truncate text-xs text-text-secondary" title={row.preview}>
                        <span className="mr-1.5 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] text-green-400/90">
                          {row.distinctCount}
                        </span>
                        {valueHit && q ? <span className="text-green-300">{row.preview}</span> : row.preview}
                      </span>
                      <span className="text-right text-xs text-green-400/80">{isSelected ? '收起' : '查看'}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {selectedSummary && (
            <div className="flex h-full min-h-0 w-[min(400px,42%)] shrink-0 flex-col overflow-hidden bg-surface-secondary/30">
              <div className="flex shrink-0 items-start justify-between border-b border-border-light px-4 py-3">
                <div className="min-w-0 pr-2">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {selectedSummary.tableName}
                    <span className="mx-1.5 text-text-secondary/50">·</span>
                    {selectedSummary.columnName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-secondary" title={selectedSummary.description || '无列注释'}>
                    {selectedSummary.description || '无列注释'}
                    {selectedSummary.columnType ? ` · ${selectedSummary.columnType}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] text-text-secondary/70">
                    共 {selectedSummary.distinctCount} 个 distinct 值
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedKey(null)}
                  className="shrink-0 rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  aria-label="关闭详情面板"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 面板内搜索 + 快捷新增 */}
              <div className="shrink-0 space-y-2 border-b border-border-light px-4 py-3">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-secondary pointer-events-none" />
                <input
                  type="text"
                  value={panelSearch}
                  onChange={(e) => setPanelSearch(e.target.value)}
                  placeholder="在此列中搜索值…"
                  aria-label="搜索列内值"
                  className="w-full rounded-md border border-border-light bg-surface-primary py-1.5 pl-7 pr-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={panelAddValue}
                  onChange={(e) => setPanelAddValue(e.target.value)}
                  placeholder="新增值…"
                  aria-label="在此列新增值"
                  className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-primary px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <button
                  type="button"
                  disabled={saving || !panelAddValue.trim()}
                  onClick={async () => {
                    const ok = await onCreate({
                      tableName: selectedSummary.tableName,
                      columnName: selectedSummary.columnName,
                      cellValue: panelAddValue.trim(),
                    });
                    if (ok) setPanelAddValue('');
                  }}
                  className="shrink-0 rounded-md bg-green-600 px-2.5 py-1.5 text-xs text-white hover:bg-green-500 disabled:opacity-50"
                >
                  添加
                </button>
              </div>
            </div>

            {/* 值列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {panelFilteredValues.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-secondary">无匹配值</p>
              ) : (
                panelFilteredValues.map((entry) => {
                  const isEditing = editingId === entry.id;
                  const q = panelSearch.trim().toLowerCase();
                  const highlighted = q && entry.cellValue.toLowerCase().includes(q);

                  return (
                    <div
                      key={entry.id}
                      className={`group mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover/60 ${
                        highlighted ? 'bg-green-900/10' : ''
                      }`}
                    >
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={editingDraft.cellValue}
                            onChange={(e) => setEditingDraft((prev) => ({ ...prev, cellValue: e.target.value }))}
                            aria-label="编辑单元格值"
                            className="min-w-0 flex-1 rounded border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await onUpdate(entry.id, editingDraft);
                              if (ok) setEditingId(null);
                            }}
                            disabled={saving}
                            className="rounded p-1 text-green-400 hover:bg-green-900/20 disabled:opacity-50"
                            title="保存"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                            title="取消"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            className={`min-w-0 flex-1 truncate text-sm ${highlighted ? 'text-green-300' : 'text-text-primary'}`}
                            title={entry.cellValue}
                          >
                            {entry.cellValue}
                          </span>
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(entry.id);
                                setEditingDraft({
                                  tableName: entry.tableName,
                                  columnName: entry.columnName,
                                  cellValue: entry.cellValue,
                                });
                              }}
                              className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-green-400"
                              title="编辑"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(entry.id)}
                              className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-red-400"
                              title="删除"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SchemaViewer({
  schemas,
  initialSelectedTable,
  onBack,
  onDeleteTable,
  onUpdateTable,
  onRegenerateTables,
  regenerating,
}: {
  schemas: LightSchemaEntry[];
  initialSelectedTable?: string;
  onBack: () => void;
  onDeleteTable: (tableName: string) => Promise<boolean>;
  onUpdateTable: (tableName: string, columns: LightSchemaColumn[], primaryKeys: string[]) => Promise<boolean>;
  onRegenerateTables: (tableNames: string[]) => Promise<boolean>;
  regenerating: boolean;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>(() => {
    if (initialSelectedTable && schemas.some((s) => s.tableName === initialSelectedTable)) {
      return initialSelectedTable;
    }
    return schemas[0]?.tableName ?? '';
  });
  const [activeTab, setActiveTab] = useState<'columns' | 'ddl'>('columns');
  const [deletingTable, setDeletingTable] = useState<string | null>(null);

  // 列编辑状态：editingRow = 当前编辑的列名
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [draft, setDraft] = useState<ColDraft>(blankDraft());
  const [saving, setSaving] = useState(false);

  const filteredSchemas = schemas.filter((s) =>
    s.tableName.toLowerCase().includes(search.toLowerCase()),
  );

  // 仅在 schemas 异步加载后补一次初始选中；之后左侧列表点击由 setSelected 控制，不再被 initialSelectedTable 覆盖
  const initialAppliedRef = useRef(false);
  useEffect(() => {
    initialAppliedRef.current = false;
  }, [initialSelectedTable]);

  useEffect(() => {
    if (initialAppliedRef.current || schemas.length === 0) return;
    if (initialSelectedTable && schemas.some((s) => s.tableName === initialSelectedTable)) {
      setSelected(initialSelectedTable);
    } else {
      setSelected((prev) => {
        if (prev) return prev;
        return schemas[0]?.tableName ?? '';
      });
    }
    initialAppliedRef.current = true;
  }, [initialSelectedTable, schemas]);

  // 表被删除后，若当前选中已不存在则顺延回退（有搜索词时在筛选结果内顺延）
  useEffect(() => {
    if (schemas.length === 0) {
      if (selected) setSelected('');
      return;
    }
    if (selected && schemas.some((s) => s.tableName === selected)) return;

    const ordered = orderedSchemaTableNames(schemas, search);
    setSelected(ordered[0] ?? schemas[0]?.tableName ?? '');
  }, [schemas, selected, search]);

  const current = schemas.find((s) => s.tableName === selected) ?? null;

  let parsed: LightSchemaParsed | null = null;
  if (current) {
    try { parsed = JSON.parse(current.content); } catch (_) {}
  }

  const startEdit = (col: LightSchemaColumn) => {
    setEditingRow(col.name);
    setDraft(parsedToColDraft(col));
  };

  const cancelEdit = () => {
    setEditingRow(null);
    setDraft(blankDraft());
  };

  /** 删除或保存后统一触发 upsert */
  const commitColumns = async (newCols: LightSchemaColumn[], pks: string[]) => {
    if (!parsed) return false;
    setSaving(true);
    try {
      return await onUpdateTable(parsed.tableName, newCols, pks);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRow = async () => {
    if (!parsed || !editingRow) return;
    const newCols = parsed.columns.map((c) =>
      c.name === editingRow
        ? {
            ...c,
            description: draft.description.trim(),
            sampleValues: draft.sampleValues
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          }
        : c,
    );
    const ok = await commitColumns(newCols, parsed.primaryKeys ?? []);
    if (ok) cancelEdit();
  };

  const handleDeleteCol = async (colName: string) => {
    if (!parsed) return;
    if (!window.confirm(`确定删除列「${colName}」吗？`)) return;
    const newCols = parsed.columns.filter((c) => c.name !== colName);
    await commitColumns(newCols, (parsed.primaryKeys ?? []).filter((pk) => pk !== colName));
  };

  const handleDelete = async (tableName: string) => {
    if (!window.confirm(`确定删除「${tableName}」的 Light Schema 吗？此操作无法撤销。`)) return;
    const ordered = orderedSchemaTableNames(schemas, search);
    const nextTable = pickNextTableName(ordered, tableName);
    setDeletingTable(tableName);
    try {
      const ok = await onDeleteTable(tableName);
      if (!ok) return;
      if (selected === tableName) {
        setSelected(nextTable);
        setActiveTab('columns');
        cancelEdit();
      }
    } finally {
      setDeletingTable(null);
    }
  };

  const handleRegenerate = async (tableNames: string[], label: string) => {
    if (tableNames.length === 0) return;
    if (!window.confirm(`确定重新生成 ${label} 的 Light Schema 吗？将覆盖已有内容。`)) return;
    await onRegenerateTables(tableNames);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-primary">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between gap-4 border-b border-border-light bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))] px-5 py-3.5 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-border-light/70 bg-surface-primary/70 px-3 py-2 text-sm text-text-secondary hover:border-green-500/40 hover:bg-surface-hover hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <div className="h-8 w-px bg-border-light/70" />
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-green-500/20 bg-green-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.06)]">
            <Database className="h-4 w-4 text-green-400" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.22em] text-green-500/70">Schema Browser</div>
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-text-primary">Light Schema 预览</span>
              <span className="rounded-full border border-green-700/30 bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
                {schemas.length} 张表
              </span>
            </div>
          </div>
        </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-text-secondary">
          <span className="hidden rounded-full border border-border-light bg-surface-primary/60 px-2.5 py-1 lg:inline">
            当前视图: {activeTab === 'columns' ? '列详情' : 'DDL'}
          </span>
          <span className="hidden rounded-full border border-border-light bg-surface-primary/60 px-2.5 py-1 lg:inline">
            已筛选: {filteredSchemas.length}
          </span>
          {selected && (
            <button
              type="button"
              onClick={() => handleRegenerate([selected], `「${selected}」`)}
              disabled={regenerating}
              className="flex items-center gap-1 rounded-full border border-green-700/40 bg-green-900/20 px-2.5 py-1 text-green-300 transition-colors hover:border-green-500 hover:bg-green-800/30 disabled:opacity-50"
            >
              {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              重新生成当前表
            </button>
          )}
          {schemas.length > 1 && (
            <button
              type="button"
              onClick={() => handleRegenerate(schemas.map((s) => s.tableName), `全部 ${schemas.length} 张表`)}
              disabled={regenerating}
              className="flex items-center gap-1 rounded-full border border-border-light bg-surface-primary/60 px-2.5 py-1 transition-colors hover:border-green-500 hover:text-green-400 disabled:opacity-50"
            >
              {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              重新生成全部
            </button>
          )}
        </div>
      </div>

      {/* 双面板主体 */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── 左侧表列表 ── */}
        <div className="w-52 shrink-0 flex flex-col bg-surface-secondary border-r border-border-light overflow-hidden">
          {/* 搜索框 */}
          <div className="px-3 py-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-secondary pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索表名…"
                aria-label="搜索表名"
                className="w-full rounded-lg border border-border-light bg-surface-primary py-1.5 pl-8 pr-7 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-green-500 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                  aria-label="清空"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* 表列表 */}
          <div className="flex-1 overflow-y-auto">
            {filteredSchemas.length === 0 ? (
              <p className="px-3 py-6 text-xs text-text-secondary text-center">无匹配表名</p>
            ) : (
              <ul>
                {filteredSchemas.map((s) => {
                  let cols = 0;
                  try { cols = (JSON.parse(s.content) as LightSchemaParsed).columns.length; } catch (_) {}
                  const isActive = selected === s.tableName;
                  return (
                    <li key={s.tableName} className="group flex items-stretch">
                      <button
                        onClick={() => { setSelected(s.tableName); setActiveTab('columns'); }}
                        className={`flex-1 min-w-0 text-left px-4 py-3 transition-all border-l-[3px] ${
                          isActive
                            ? 'border-l-green-500 bg-green-900/25 text-green-300'
                            : 'border-l-transparent text-text-primary hover:bg-surface-hover hover:border-l-border-light'
                        }`}
                      >
                        <div className={`text-xs font-mono font-medium truncate leading-tight ${isActive ? 'text-green-300' : 'text-text-primary'}`} title={s.tableName}>
                          {s.tableName}
                        </div>
                        {cols > 0 && (
                          <div className={`text-[11px] mt-0.5 ${isActive ? 'text-green-500/70' : 'text-text-secondary'}`}>
                            {cols} 列
                          </div>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(s.tableName);
                        }}
                        disabled={deletingTable === s.tableName}
                        title={`删除 ${s.tableName}`}
                        aria-label={`删除 ${s.tableName}`}
                        className={`shrink-0 flex items-center justify-center w-9 transition-colors ${
                          isActive
                            ? 'text-red-400/70 hover:text-red-400 hover:bg-red-900/20'
                            : 'text-text-secondary/40 hover:text-red-400 hover:bg-red-900/10 opacity-0 group-hover:opacity-100'
                        } disabled:opacity-50`}
                      >
                        {deletingTable === s.tableName
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 底部统计 */}
          <div className="border-t border-border-light px-4 py-2 shrink-0">
            <span className="text-[11px] text-text-secondary">
              {filteredSchemas.length !== schemas.length
                ? `${filteredSchemas.length} / ${schemas.length} 张`
                : `共 ${schemas.length} 张表`}
            </span>
          </div>
        </div>

        {/* ── 右侧详情 ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-surface-primary text-text-primary">
          {current && parsed ? (
            <>
              {/* 详情页头 */}
              <div className="flex items-start justify-between border-b border-border-light bg-surface-secondary px-5 py-4 shrink-0">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-primary">
                    <Database className="h-4 w-4 text-green-500" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold font-mono text-text-primary truncate">{parsed.tableName}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-text-secondary">{parsed.columns.length} 列</span>
                      {parsed.primaryKeys?.length > 0 && (
                        <>
                          <span className="text-text-secondary/40">·</span>
                          <span className="text-xs text-text-secondary">主键</span>
                          {parsed.primaryKeys.map((pk) => (
                            <span key={pk} className="rounded border border-yellow-700/30 bg-yellow-900/15 px-1.5 py-0.5 text-[11px] font-mono text-yellow-400">
                              {pk}
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 标签页切换 */}
                <div className="flex items-center gap-0.5 rounded-lg border border-border-light bg-surface-primary p-0.5 shrink-0">
                  {(['columns', 'ddl'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        activeTab === tab
                          ? 'bg-green-600 text-white'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {tab === 'columns' ? '列详情' : 'DDL'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 详情内容 */}
              <div className="flex-1 overflow-y-auto bg-surface-primary">
                {activeTab === 'columns' ? (
                  <div className="flex flex-col">
                    <table className="not-prose w-full border-collapse text-text-primary">
                      <thead className="sticky top-0 z-10 bg-surface-secondary">
                        <tr>
                          <th className="w-10 border-b border-border-light px-4 py-2.5 text-left text-xs font-medium text-text-secondary">#</th>
                          <th className="border-b border-border-light px-4 py-2.5 text-left text-xs font-medium text-text-secondary">列名 / 注释</th>
                          <th className="w-28 border-b border-border-light px-4 py-2.5 text-left text-xs font-medium text-text-secondary">类型</th>
                          <th className="w-24 border-b border-border-light px-4 py-2.5 text-left text-xs font-medium text-text-secondary">约束</th>
                          <th className="border-b border-border-light px-4 py-2.5 text-left text-xs font-medium text-text-secondary">采样值</th>
                        </tr>
                      </thead>
                      <tbody>
                      {parsed.columns.map((col, i) => {
                        const isPK = parsed!.primaryKeys?.includes(col.name);
                        const isEditing = editingRow === col.name;
                        if (isEditing) {
                          return (
                            <tr key={col.name} className="border-b border-green-600/20 bg-green-900/5">
                              <td className="px-4 py-3 text-xs text-text-tertiary align-top">{i + 1}</td>
                              <td className="px-4 py-3 align-top">
                                <div className="flex items-center gap-1.5 mb-2">
                                  {isPK && <Key className="h-3.5 w-3.5 shrink-0 text-yellow-500" aria-label="主键" />}
                                  <span className={`font-mono text-sm ${isPK ? 'text-yellow-300' : 'text-text-primary'}`}>{col.name}</span>
                                </div>
                                <input
                                  autoFocus
                                  className="w-full rounded-md border border-border-light bg-surface-secondary px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-green-500"
                                  placeholder="注释"
                                  value={draft.description}
                                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                                />
                              </td>
                              <td className="px-4 py-3 align-top">
                                <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] ${typeStyle(col.type)}`}>
                                  {col.type}
                                </span>
                              </td>
                              <td className="px-4 py-3 align-top">
                                {col.nullable ? (
                                  <span className="text-xs text-text-tertiary">NULL</span>
                                ) : (
                                  <span className="inline-block rounded border border-orange-700/30 bg-orange-900/15 px-1.5 py-0.5 text-[11px] text-orange-400">
                                    NOT NULL
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div className="flex items-start gap-2">
                                  <input
                                    className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2.5 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-green-500"
                                    placeholder="采样值，逗号分隔"
                                    value={draft.sampleValues}
                                    onChange={(e) => setDraft((d) => ({ ...d, sampleValues: e.target.value }))}
                                  />
                                  <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                                    <button
                                      onClick={handleSaveRow}
                                      disabled={saving}
                                      title="保存"
                                      className="rounded p-1.5 text-green-400 hover:bg-green-900/20 disabled:opacity-40"
                                    >
                                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                    </button>
                                    <button onClick={cancelEdit} title="取消" className="rounded p-1.5 text-text-secondary hover:bg-surface-hover">
                                      <XCircle className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr
                            key={col.name}
                            className="group border-b border-border-light/40 transition-colors hover:bg-surface-hover/30"
                          >
                            <td className="px-4 py-3 text-xs text-text-tertiary align-top">{i + 1}</td>
                            <td className="px-4 py-3 align-top">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    {isPK && <Key className="h-3.5 w-3.5 shrink-0 text-yellow-500" aria-label="主键" />}
                                    <span className={`font-mono text-sm ${isPK ? 'text-yellow-300' : 'text-text-primary'}`}>
                                      {col.name}
                                    </span>
                                  </div>
                                  {col.description ? (
                                    <p className="mt-1 text-xs leading-relaxed text-text-secondary-alt">
                                      {col.description}
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-xs text-text-tertiary italic">无注释</p>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    onClick={() => startEdit(col)}
                                    title="编辑注释和采样值"
                                    disabled={editingRow !== null}
                                    className="rounded p-1.5 text-text-secondary hover:text-green-400 hover:bg-green-900/15 disabled:opacity-30"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteCol(col.name)}
                                    title="从 Light Schema 移除此列"
                                    disabled={saving || editingRow !== null}
                                    className="rounded p-1.5 text-text-secondary hover:text-red-400 hover:bg-red-900/15 disabled:opacity-30"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] ${typeStyle(col.type)}`}>
                                {col.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top">
                              {col.nullable ? (
                                <span className="text-xs text-text-tertiary">NULL</span>
                              ) : (
                                <span className="inline-block rounded border border-orange-700/30 bg-orange-900/15 px-1.5 py-0.5 text-[11px] text-orange-400">
                                  NOT NULL
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top">
                              {col.sampleValues && col.sampleValues.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {col.sampleValues.map((v) => (
                                    <span
                                      key={v}
                                      className="rounded border border-border-light bg-surface-secondary px-1.5 py-0.5 text-[11px] font-mono text-text-secondary"
                                      title={v}
                                    >
                                      {v}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-text-tertiary">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-5">
                    <pre className="rounded-xl border border-border-light bg-surface-secondary p-5 text-xs font-mono text-green-300 leading-relaxed whitespace-pre-wrap break-words">
                      {current.ddlText || '-- DDL 未生成'}
                    </pre>
                  </div>
                )}
              </div>

              {/* 底部状态栏 */}
              <div className="flex items-center justify-between border-t border-border-light bg-surface-secondary px-6 py-2 shrink-0">
                <span className="text-[11px] text-text-secondary">
                  更新于 {new Date(current.createdAt).toLocaleString()}
                </span>
                <span className="text-[11px] text-text-secondary">
                  {parsed.columns.length} 列 · {parsed.columns.filter((c) => !c.nullable).length} NOT NULL
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-secondary border border-border-light">
                  <Database className="h-6 w-6 text-text-secondary/40" />
                </div>
                <p className="text-sm text-text-secondary">从左侧选择一张表查看详情</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface DataSourcePreprocessingProps {
  dataSourceId: string;
  dataSourceName?: string;
  onBack: () => void;
}

export default function DataSourcePreprocessing({
  dataSourceId,
  dataSourceName,
  onBack,
}: DataSourcePreprocessingProps) {
  const { showToast } = useToastContext();

  // 子视图：'main' | 'schema-viewer' | 'cell-viewer'
  const [view, setView] = useState<'main' | 'schema-viewer' | 'cell-viewer'>('main');

  const [allTables, setAllTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [cellSelectedTables, setCellSelectedTables] = useState<Set<string>>(new Set());
  const [loadingTables, setLoadingTables] = useState(false);
  const [dbSchemas, setDbSchemas] = useState<DatabaseSchemaInfo[]>([]);
  const [selectedSchemaName, setSelectedSchemaName] = useState('public');
  const [loadingDbSchemas, setLoadingDbSchemas] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showCellPicker, setShowCellPicker] = useState(false);

  const [schemas, setSchemas] = useState<LightSchemaEntry[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [schemaViewerTable, setSchemaViewerTable] = useState<string | null>(null);
  const [cellViewerTable, setCellViewerTable] = useState<string | null>(null);
  const cachedTables = new Set(schemas.map((s) => s.tableName));

  const [sampleLimit, setSampleLimit] = useState(5);
  const [generatingSchema, setGeneratingSchema] = useState(false);
  const [schemaResult, setSchemaResult] = useState<{ count: number; tables: string[] } | null>(null);

  const [rowLimit, setRowLimit] = useState(100);
  const [vectorizing, setVectorizing] = useState(false);
  const [cellResult, setCellResult] = useState<{ count: number } | null>(null);
  const [cellEntries, setCellEntries] = useState<CellVectorEntry[]>([]);
  const [loadingCellEntries, setLoadingCellEntries] = useState(false);
  const [savingCellEntry, setSavingCellEntry] = useState(false);

  const schemasLoadSeq = useRef(0);
  const cellsLoadSeq = useRef(0);

  const cellTableNames = useMemo(
    () => [...new Set(cellEntries.map((e) => e.tableName))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [cellEntries],
  );
  const cellColumnCount = useMemo(
    () => new Set(cellEntries.map((e) => `${e.tableName}::${e.columnName}`)).size,
    [cellEntries],
  );


  const fetchTables = async (cachedSet?: Set<string>, schemaName = selectedSchemaName) => {
    setLoadingTables(true);
    try {
      const res = await (dataService as any).listDataSourceSchemaTables(dataSourceId, schemaName);
      if (res?.success && res?.data?.tables) {
        const tables = [...res.data.tables].sort();
        setAllTables(tables);
        // Light Schema：优先选未生成的（增量默认）；若全部已生成则全选
        const already = cachedSet ?? new Set<string>();
        const ungenerated = tables.filter((t) => !already.has(t));
        setSelectedTables(new Set(ungenerated.length > 0 ? ungenerated : tables));
        // Cell 向量化：优先选已有 Light Schema 的表；若没有则全选
        const hasSchema = tables.filter((t) => already.has(t));
        setCellSelectedTables(new Set(hasSchema.length > 0 ? hasSchema : tables));
      }
    } catch (err: any) {
      showToast({ message: `加载表列表失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setLoadingTables(false);
    }
  };

  const fetchDbSchemas = async () => {
    setLoadingDbSchemas(true);
    try {
      const res = await (dataService as any).listDataSourceSchemas(dataSourceId);
      if (res?.success && res?.data?.schemas) {
        const list: DatabaseSchemaInfo[] = res.data.schemas || [];
        setDbSchemas(list);
        const preferred = list.find((s) => s.schemaName === 'public') || list[0];
        if (preferred) {
          setSelectedSchemaName(preferred.schemaName);
          return preferred.schemaName;
        }
      }
    } catch (err: any) {
      showToast({ message: `加载 Schema 列表失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setLoadingDbSchemas(false);
    }
    return selectedSchemaName;
  };

  const fetchSchemas = async (): Promise<LightSchemaEntry[]> => {
    const seq = ++schemasLoadSeq.current;
    setLoadingSchemas(true);
    try {
      const res = await (dataService as any).getLightSchemas(dataSourceId);
      if (seq !== schemasLoadSeq.current) return [];
      if (res?.success) {
        const list: LightSchemaEntry[] = res.data || [];
        setSchemas(list);
        return list;
      }
    } catch (_) {
      // 静默
    } finally {
      if (seq === schemasLoadSeq.current) setLoadingSchemas(false);
    }
    return [];
  };

  const fetchCellEntries = async (): Promise<CellVectorEntry[]> => {
    const seq = ++cellsLoadSeq.current;
    setLoadingCellEntries(true);
    try {
      const res = await (dataService as any).getCells(dataSourceId, { limit: 2000 });
      if (seq !== cellsLoadSeq.current) return [];
      if (res?.success) {
        const list: CellVectorEntry[] = res.data || [];
        setCellEntries(list);
        return list;
      }
    } catch (err: any) {
      if (seq === cellsLoadSeq.current) {
        showToast({ message: `加载 Cell 向量结果失败: ${err?.message || err}`, status: 'error' });
      }
    } finally {
      if (seq === cellsLoadSeq.current) setLoadingCellEntries(false);
    }
    return [];
  };

  // 快捷：选所有未生成的表（增量模式）
  const selectIncremental = () => {
    const ungenerated = allTables.filter((t) => !cachedTables.has(t));
    setSelectedTables(new Set(ungenerated.length > 0 ? ungenerated : allTables));
  };

  // 快捷：全选（全量重建）
  const selectAll = () => setSelectedTables(new Set(allTables));

  useEffect(() => {
    const schemasSeq = ++schemasLoadSeq.current;
    // 先拉 schema 缓存，再用缓存集合初始化选表默认值
    (async () => {
      setLoadingSchemas(true);
      let cached = new Set<string>();
      try {
        const res = await (dataService as any).getLightSchemas(dataSourceId);
        if (schemasSeq !== schemasLoadSeq.current) return;
        if (res?.success) {
          const list: LightSchemaEntry[] = res.data || [];
          setSchemas(list);
          cached = new Set(list.map((s) => s.tableName));
        }
      } catch (_) {
        // 静默
      } finally {
        if (schemasSeq === schemasLoadSeq.current) setLoadingSchemas(false);
      }
      if (schemasSeq !== schemasLoadSeq.current) return;
      await fetchCellEntries();
      if (schemasSeq !== schemasLoadSeq.current) return;
      const schemaName = await fetchDbSchemas();
      if (schemasSeq !== schemasLoadSeq.current) return;
      await fetchTables(cached, schemaName);
    })();
  }, [dataSourceId]);

  const handleSchemaChange = async (schemaName: string) => {
    setSelectedSchemaName(schemaName);
    setAllTables([]);
    setSelectedTables(new Set());
    setCellSelectedTables(new Set());
    await fetchTables(cachedTables, schemaName);
  };

  const selectedList = allTables.filter((t) => selectedTables.has(t));

  const handleGenerateSchema = async () => {
    if (selectedList.length === 0) { showToast({ message: '请先选择要处理的表', status: 'warning' }); return; }
    setGeneratingSchema(true);
    setSchemaResult(null);
    try {
      const res = await (dataService as any).generateLightSchema(dataSourceId, {
        sampleLimit,
        tableNames: selectedList,
        schemaName: selectedSchemaName,
      });
      if (res?.success) {
        setSchemaResult({ count: res.count, tables: res.tables });
        showToast({ message: `成功生成 ${res.count} 张表的 Light Schema`, status: 'success' });
        await fetchSchemas();
      } else {
        showToast({ message: `生成失败: ${res?.error || '未知错误'}`, status: 'error' });
      }
    } catch (err: any) {
      showToast({ message: `生成 Light Schema 失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setGeneratingSchema(false);
    }
  };

  const handleRegenerateSchema = async (tableNames: string[]): Promise<boolean> => {
    if (tableNames.length === 0) return false;
    setGeneratingSchema(true);
    try {
      const res = await (dataService as any).generateLightSchema(dataSourceId, {
        sampleLimit,
        tableNames,
        schemaName: selectedSchemaName,
      });
      if (res?.success) {
        showToast({ message: `已重新生成 ${res.count} 张表的 Light Schema`, status: 'success' });
        await fetchSchemas();
        return true;
      }
      showToast({ message: `重新生成失败: ${res?.error || '未知错误'}`, status: 'error' });
      return false;
    } catch (err: any) {
      showToast({ message: `重新生成 Light Schema 失败: ${err?.message || err}`, status: 'error' });
      return false;
    } finally {
      setGeneratingSchema(false);
    }
  };

  const cellSelectedList = allTables.filter((t) => cellSelectedTables.has(t));

  const handleDeleteSchema = async (tableName: string): Promise<boolean> => {
    try {
      const res = await (dataService as any).deleteLightSchema(dataSourceId, tableName);
      if (!res?.success) {
        showToast({ message: `删除失败: ${res?.error || '未知错误'}`, status: 'error' });
        return false;
      }

      // 作废进行中的列表拉取，避免覆盖本次删除
      schemasLoadSeq.current += 1;
      setSchemas((prev) => {
        const next = prev.filter((s) => s.tableName !== tableName);
        if (next.length === 0) setView('main');
        return next;
      });
      if (schemaViewerTable === tableName) setSchemaViewerTable(null);

      const list = await fetchSchemas();
      if (list.some((s) => s.tableName === tableName)) {
        showToast({ message: `删除未生效：${tableName} 仍存在`, status: 'error' });
        return false;
      }
      showToast({ message: `已删除 ${tableName} 的 Light Schema`, status: 'success' });
      return true;
    } catch (err: any) {
      showToast({ message: `删除 Light Schema 失败: ${err?.message || err}`, status: 'error' });
      return false;
    }
  };

  const handleUpdateSchema = async (
    tableName: string,
    columns: LightSchemaColumn[],
    primaryKeys: string[],
  ): Promise<boolean> => {
    try {
      const res = await (dataService as any).updateLightSchema(dataSourceId, tableName, { columns, primaryKeys });
      if (res?.success) {
        // 重新拉取最新 schema 内容（含新 DDL / embedding）
        await fetchSchemas();
        showToast({ message: `已更新 ${tableName} 的 Light Schema`, status: 'success' });
        return true;
      }
      showToast({ message: `更新失败: ${res?.error || '未知错误'}`, status: 'error' });
      return false;
    } catch (err: any) {
      showToast({ message: `更新 Light Schema 失败: ${err?.message || err}`, status: 'error' });
      return false;
    }
  };

  const handleVectorizeCells = async () => {
    if (cellSelectedList.length === 0) { showToast({ message: '请先选择要向量化的表', status: 'warning' }); return; }
    setVectorizing(true);
    setCellResult(null);
    try {
      const res = await (dataService as any).vectorizeCells(dataSourceId, {
        rowLimit,
        tableNames: cellSelectedList,
        schemaName: selectedSchemaName,
      });
      if (res?.success) {
        setCellResult({ count: res.count });
        showToast({ message: `成功写入 ${res.count} 条 Cell 向量`, status: 'success' });
        await fetchCellEntries();
      } else {
        showToast({ message: `向量化失败: ${res?.error || '未知错误'}`, status: 'error' });
      }
    } catch (err: any) {
      showToast({ message: `单元格向量化失败: ${err?.message || err}`, status: 'error' });
    } finally {
      setVectorizing(false);
    }
  };

  const handleCreateCellEntry = async (payload: { tableName: string; columnName: string; cellValue: string }): Promise<boolean> => {
    if (!payload.tableName.trim() || !payload.columnName.trim() || !payload.cellValue.trim()) {
      showToast({ message: '请填写完整的表名、列名和单元格值', status: 'warning' });
      return false;
    }
    setSavingCellEntry(true);
    try {
      const res = await (dataService as any).createCell(dataSourceId, payload);
      if (res?.success) {
        showToast({ message: 'Cell 向量已新增', status: 'success' });
        await fetchCellEntries();
        return true;
      }
      showToast({ message: `新增失败: ${res?.error || '未知错误'}`, status: 'error' });
      return false;
    } catch (err: any) {
      showToast({ message: `新增 Cell 向量失败: ${err?.message || err}`, status: 'error' });
      return false;
    } finally {
      setSavingCellEntry(false);
    }
  };

  const handleUpdateCellEntry = async (
    id: number,
    payload: { tableName: string; columnName: string; cellValue: string },
  ): Promise<boolean> => {
    if (!payload.tableName.trim() || !payload.columnName.trim() || !payload.cellValue.trim()) {
      showToast({ message: '请填写完整的表名、列名和单元格值', status: 'warning' });
      return false;
    }
    setSavingCellEntry(true);
    try {
      const res = await (dataService as any).updateCell(dataSourceId, id, payload);
      if (res?.success) {
        showToast({ message: 'Cell 向量已更新', status: 'success' });
        await fetchCellEntries();
        return true;
      }
      showToast({ message: `更新失败: ${res?.error || '未知错误'}`, status: 'error' });
      return false;
    } catch (err: any) {
      showToast({ message: `更新 Cell 向量失败: ${err?.message || err}`, status: 'error' });
      return false;
    } finally {
      setSavingCellEntry(false);
    }
  };

  const handleDeleteCellEntry = async (id: number): Promise<boolean> => {
    if (!window.confirm('确定删除这条 Cell 向量记录吗？')) return false;
    setSavingCellEntry(true);
    try {
      const res = await (dataService as any).deleteCell(dataSourceId, id);
      if (res?.success) {
        showToast({ message: 'Cell 向量已删除', status: 'success' });
        await fetchCellEntries();
        return true;
      }
      showToast({ message: `删除失败: ${res?.error || '未知错误'}`, status: 'error' });
      return false;
    } catch (err: any) {
      showToast({ message: `删除 Cell 向量失败: ${err?.message || err}`, status: 'error' });
      return false;
    } finally {
      setSavingCellEntry(false);
    }
  };

  const handleDeleteCellTable = async (tableName: string): Promise<boolean> => {
    try {
      const res = await dataService.deleteCellsByTable(dataSourceId, tableName);
      if (!res?.success) {
        showToast({ message: `删除失败: ${res?.error || '未知错误'}`, status: 'error' });
        return false;
      }

      cellsLoadSeq.current += 1;
      setCellEntries((prev) => {
        const remaining = prev.filter((e) => e.tableName !== tableName);
        if (remaining.length === 0) setView('main');
        return remaining;
      });
      if (cellViewerTable === tableName) setCellViewerTable(null);

      const list = await fetchCellEntries();
      if (list.some((e) => e.tableName === tableName)) {
        showToast({ message: `删除未生效：${tableName} 仍存在`, status: 'error' });
        return false;
      }
      showToast({ message: `已删除 ${tableName} 的全部 Cell 向量`, status: 'success' });
      return true;
    } catch (err: any) {
      showToast({ message: `删除 Cell 向量失败: ${err?.message || err}`, status: 'error' });
      return false;
    }
  };

  const tableLabel = loadingTables
    ? '加载中…'
    : selectedList.length === allTables.length
    ? `全部 (${allTables.length})`
    : `已选 ${selectedList.length} / ${allTables.length}`;

  // ── Schema 预览子视图 ──
  if (view === 'schema-viewer') {
    return (
      <SchemaViewer
        key={schemaViewerTable ?? '__default__'}
        schemas={schemas}
        initialSelectedTable={schemaViewerTable ?? undefined}
        onBack={() => {
          setSchemaViewerTable(null);
          setView('main');
        }}
        onDeleteTable={handleDeleteSchema}
        onUpdateTable={handleUpdateSchema}
        onRegenerateTables={handleRegenerateSchema}
        regenerating={generatingSchema}
      />
    );
  }

  // ── Cell 向量预览子视图 ──
  if (view === 'cell-viewer') {
    return (
      <CellVectorViewer
        key={`${dataSourceId}-${cellViewerTable ?? '__default__'}`}
        entries={cellEntries}
        schemas={schemas}
        loading={loadingCellEntries}
        saving={savingCellEntry}
        initialSelectedTable={cellViewerTable ?? undefined}
        onBack={() => {
          setCellViewerTable(null);
          setView('main');
        }}
        onRefresh={fetchCellEntries}
        onCreate={handleCreateCellEntry}
        onUpdate={handleUpdateCellEntry}
        onDelete={handleDeleteCellEntry}
        onDeleteTable={handleDeleteCellTable}
      />
    );
  }

  // ── 主视图 ──
  return (
    <>
      {showPicker && (
        <TablePickerModal
          allTables={allTables}
          selected={selectedTables}
          onConfirm={(next) => setSelectedTables(next)}
          onClose={() => setShowPicker(false)}
          cachedTables={cachedTables}
          title="选择表（Light Schema）"
          preferCached={false}
        />
      )}
      {showCellPicker && (
        <TablePickerModal
          allTables={allTables}
          selected={cellSelectedTables}
          onConfirm={(next) => setCellSelectedTables(next)}
          onClose={() => setShowCellPicker(false)}
          cachedTables={cachedTables}
          title="选择表（单元格向量化）"
          preferCached={true}
        />
      )}

      <div className="flex h-full flex-col overflow-y-auto">
        <div className="flex flex-col gap-5 p-6">

          {/* 页头 */}
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover transition-colors">
              <ArrowLeft className="h-4 w-4" />
              返回
            </button>
            <h2 className="text-xl font-semibold text-text-primary">
              数据预处理{dataSourceName ? ` · ${dataSourceName}` : ''}
            </h2>
          </div>

          {/* ── Schema 选择 ── */}
          <section className="rounded-xl border border-border-light bg-surface-primary p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-text-primary">当前 Schema</span>
              </div>
              <select
                value={selectedSchemaName}
                onChange={(e) => handleSchemaChange(e.target.value)}
                disabled={loadingDbSchemas || loadingTables}
                aria-label="选择数据库 Schema"
                className="min-w-[180px] rounded-md border border-border-light bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-50"
              >
                {dbSchemas.length === 0 ? (
                  <option value={selectedSchemaName}>{loadingDbSchemas ? '加载中…' : selectedSchemaName}</option>
                ) : (
                  dbSchemas.map((s) => (
                    <option key={s.schemaName} value={s.schemaName}>
                      {s.schemaName}{s.tableCount !== null ? `（${s.tableCount} 张表）` : ''}
                    </option>
                  ))
                )}
              </select>
              <button
                onClick={async () => {
                  const schemaName = await fetchDbSchemas();
                  await fetchTables(cachedTables, schemaName);
                }}
                disabled={loadingDbSchemas || loadingTables}
                className="flex items-center gap-1 rounded-md border border-border-light bg-surface-secondary px-2.5 py-1.5 text-xs text-text-secondary hover:text-green-400 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${(loadingDbSchemas || loadingTables) ? 'animate-spin' : ''}`} />
                刷新
              </button>
              <span className="text-xs text-text-secondary">
                {loadingTables ? '正在加载表名…' : `当前 ${selectedSchemaName}：${allTables.length} 张表`}
              </span>
            </div>
          </section>

          {/* ── Light Schema 区块 ── */}
          <section className="rounded-xl border border-border-light bg-surface-primary p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-green-500" />
                <h3 className="text-base font-semibold text-text-primary">Light Schema 生成</h3>
                {/* 增量/全量模式提示 */}
                {!loadingTables && allTables.length > 0 && (
                  <span className="text-xs text-text-secondary">
                    {(() => {
                      const ungeneratedCount = allTables.filter((t) => !cachedTables.has(t)).length;
                      if (cachedTables.size === 0) return '首次生成';
                      if (ungeneratedCount === 0) return '全量重建模式';
                      return `增量模式 · 新增 ${ungeneratedCount} 张`;
                    })()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* 增量/全量快捷切换 */}
                {!loadingTables && cachedTables.size > 0 && (
                  <div className="flex items-center gap-1 rounded-lg border border-border-light bg-surface-secondary p-0.5">
                    <button
                      onClick={selectIncremental}
                      title="只选未生成过的表"
                      className={`px-2 py-0.5 rounded-md text-xs transition-colors ${
                        selectedList.length === allTables.filter(t => !cachedTables.has(t)).length && !selectedList.some(t => cachedTables.has(t))
                          ? 'bg-green-600 text-white'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      增量
                    </button>
                    <button
                      onClick={selectAll}
                      title="选全部表（覆盖重写）"
                      className={`px-2 py-0.5 rounded-md text-xs transition-colors ${
                        selectedList.length === allTables.length
                          ? 'bg-surface-hover text-text-primary'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      全量
                    </button>
                  </div>
                )}
                <button
                  onClick={() => !loadingTables && setShowPicker(true)}
                  disabled={loadingTables}
                  className="flex items-center gap-1.5 rounded-lg border border-border-light bg-surface-secondary px-3 py-1.5 text-xs text-text-secondary hover:border-green-500 hover:text-green-400 disabled:opacity-50 transition-colors"
                >
                  {loadingTables ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {tableLabel}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary whitespace-nowrap">文本列采样行数</label>
              <input
                type="number" min={1} max={50} value={sampleLimit}
                onChange={(e) => setSampleLimit(Number(e.target.value))}
                aria-label="文本列采样行数" title="文本列采样行数" placeholder="5"
                className="w-20 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>

            <button
              onClick={handleGenerateSchema}
              disabled={generatingSchema || selectedList.length === 0}
              className="flex w-fit items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generatingSchema ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generatingSchema ? `生成中… (${selectedList.length} 张表)` : `生成 Light Schema (${selectedList.length} 张表)`}
            </button>

            {schemaResult && (
              <div className="flex items-start gap-2 text-sm text-green-400">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>已生成 {schemaResult.count} 张表：{schemaResult.tables.join('、')}</span>
              </div>
            )}

            {/* 已缓存摘要 */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                {loadingSchemas ? '加载中…' : `已存储 ${schemas.length} 张表的 Light Schema`}
              </p>
              <div className="flex items-center gap-2">
                {schemas.length > 0 && (
                  <button
                    onClick={() => {
                      setSchemaViewerTable(null);
                      setView('schema-viewer');
                    }}
                    className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                  >
                    <Database className="h-3.5 w-3.5" />
                    查看 Schema
                  </button>
                )}
                <button
                  onClick={fetchSchemas}
                  disabled={loadingSchemas}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-green-400 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingSchemas ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>
            </div>
            {schemas.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {schemas.map((s) => (
                  <li key={s.tableName}>
                    <button
                      onClick={() => {
                        setSchemaViewerTable(s.tableName);
                        setView('schema-viewer');
                      }}
                      className="rounded-md border border-green-700/40 bg-green-900/20 px-2 py-0.5 text-xs text-green-300 hover:border-green-500 hover:bg-green-800/30 hover:text-green-200 transition-colors"
                      title={`更新于 ${new Date(s.createdAt).toLocaleString()}`}
                    >
                      {s.tableName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Cell 向量化区块 ── */}
          <section className="rounded-xl border border-border-light bg-surface-primary p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-green-500" />
                <h3 className="text-base font-semibold text-text-primary">单元格向量化</h3>
                {/* 模式提示 */}
                {!loadingTables && allTables.length > 0 && (
                  <span className="text-xs text-text-secondary">
                    {cachedTables.size === 0
                      ? '建议先生成 Light Schema'
                      : cellSelectedList.every((t) => cachedTables.has(t))
                      ? `已选 ${cellSelectedList.length} 张有 Schema 的表`
                      : `已选 ${cellSelectedList.length} 张表`}
                  </span>
                )}
              </div>
              <button
                onClick={() => !loadingTables && setShowCellPicker(true)}
                disabled={loadingTables}
                className="flex items-center gap-1.5 rounded-lg border border-border-light bg-surface-secondary px-3 py-1.5 text-xs text-text-secondary hover:border-green-500 hover:text-green-400 disabled:opacity-50 transition-colors"
              >
                {loadingTables ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {loadingTables
                  ? '加载中…'
                  : cellSelectedList.length === allTables.length
                  ? `全部 (${allTables.length})`
                  : `已选 ${cellSelectedList.length} / ${allTables.length}`}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary whitespace-nowrap">每列最大采样行数</label>
              <input
                type="number" min={10} max={1000} value={rowLimit}
                onChange={(e) => setRowLimit(Number(e.target.value))}
                aria-label="每列最大采样行数" title="每列最大采样行数" placeholder="100"
                className="w-24 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>

            <button
              onClick={handleVectorizeCells}
              disabled={vectorizing || cellSelectedList.length === 0}
              className="flex w-fit items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {vectorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {vectorizing ? `向量化中… (${cellSelectedList.length} 张表)` : `开始向量化 (${cellSelectedList.length} 张表)`}
            </button>

            {cellResult && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>已写入 {cellResult.count} 条 Cell 向量</span>
              </div>
            )}

            <p className="text-xs text-text-secondary">
              仅处理 CHAR / VARCHAR / TEXT / ENUM 类型列。优先选择已生成 Light Schema 的表，效果更好。
            </p>

            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                {loadingCellEntries
                  ? '加载中…'
                  : cellEntries.length > 0
                  ? `已存储 ${cellEntries.length} 条向量 · ${cellTableNames.length} 张表 · ${cellColumnCount} 字段`
                  : '暂无 Cell 向量，请先执行向量化'}
              </p>
              <div className="flex items-center gap-2">
                {cellEntries.length > 0 && (
                  <button
                    onClick={() => {
                      setCellViewerTable(null);
                      setView('cell-viewer');
                    }}
                    className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    查看 Cell 向量
                  </button>
                )}
                <button
                  onClick={fetchCellEntries}
                  disabled={loadingCellEntries}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-green-400 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingCellEntries ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>
            </div>
            {cellTableNames.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {cellTableNames.map((name) => (
                  <li key={name}>
                    <button
                      onClick={() => {
                        setCellViewerTable(name);
                        setView('cell-viewer');
                      }}
                      className="rounded-md border border-green-700/40 bg-green-900/20 px-2 py-0.5 text-xs text-green-300 hover:border-green-500 hover:bg-green-800/30 hover:text-green-200 transition-colors"
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>
      </div>
    </>
  );
}
