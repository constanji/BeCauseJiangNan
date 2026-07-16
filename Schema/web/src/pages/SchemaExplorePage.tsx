import React from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  FolderOpen,
  Search,
  ShoppingCart,
  Table2,
  Tags,
} from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import CatalogTableSidebar from '../components/CatalogTableSidebar';
import FilterBar from '../components/FilterBar';
import LightSchemaEditor from '../components/LightSchemaEditor';
import StatusBanner from '../components/StatusBanner';
import TagBadge from '../components/TagBadge';
import TagPicker from '../components/TagPicker';
import TableDataPreviewPanel from '../components/TableDataPreviewPanel';
import { useUiState } from '../context/UiStateProvider';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import { parseLightSchemaContent } from '../lib/lightSchemaTypes';
import { pickNextCatalogId } from '../lib/reviewNav';
import { CatalogDetail, MatchSource, SearchHit, SearchMatch, Tag } from '../lib/uiState';

type ExploreGroup = {
  key: string;
  label: string;
  items: SearchHit[];
};

type DeepProgress = {
  scanned: number;
  total: number;
  currentTable: string;
  errors: Array<{ tableName: string; error: string }>;
};

type DeepConfirm = {
  mode: 'remaining' | 'selected' | 'all';
  tableNames: string[];
};

type DetailPanel = 'schema' | 'data';

function mergeSearchHits(sampleHits: SearchHit[], deepHits: SearchHit[]): SearchHit[] {
  const map = new Map<number, SearchHit>();
  for (const hit of sampleHits) {
    if (hit.lightSchemaId != null) map.set(hit.lightSchemaId, hit);
  }
  for (const hit of deepHits) {
    if (hit.lightSchemaId == null) continue;
    const existing = map.get(hit.lightSchemaId);
    if (!existing) {
      map.set(hit.lightSchemaId, hit);
      continue;
    }
    const colMap = new Map<string, SearchMatch>();
    for (const match of existing.matches) {
      const key = match.columnName || `__${match.matchSource || 'meta'}`;
      colMap.set(key, match);
    }
    for (const match of hit.matches) {
      const key = match.columnName || `__${match.matchSource || 'meta'}`;
      const prev = colMap.get(key);
      if (!prev || prev.matchSource !== 'live') colMap.set(key, match);
    }
    map.set(hit.lightSchemaId, { ...existing, matches: [...colMap.values()] });
  }
  return [...map.values()].sort((a, b) => a.tableName.localeCompare(b.tableName, 'zh-CN'));
}

function hitHasLiveMatch(hit: SearchHit) {
  return hit.matches.some((match) => match.matchSource === 'live');
}

function matchSourceLabel(source?: MatchSource) {
  switch (source) {
    case 'table':
      return '表名';
    case 'column':
      return '列名';
    case 'comment':
      return '注释';
    case 'sample':
      return '采样值';
    case 'live':
      return '实际数据';
    case 'meta':
      return '列名/注释';
    default:
      return '命中';
  }
}

function hitSourceBadges(hit: SearchHit): MatchSource[] {
  const order: MatchSource[] = ['table', 'column', 'comment', 'sample', 'live', 'meta'];
  const set = new Set<MatchSource>();
  for (const match of hit.matches) {
    if (match.matchSource) set.add(match.matchSource);
  }
  return order.filter((s) => set.has(s));
}

function buildExploreGroups(hits: SearchHit[], lockSingleSchema: boolean): ExploreGroup[] {
  if (lockSingleSchema) {
    return hits.length > 0 ? [{ key: 'flat', label: '', items: hits }] : [];
  }
  const map = new Map<string, ExploreGroup>();
  for (const hit of hits) {
    const key = `${hit.dataSourceId}|${hit.schemaName}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: `${hit.dataSourceName} · ${hit.schemaName}`,
        items: [],
      });
    }
    map.get(key)!.items.push(hit);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function flattenExploreHits(groups: ExploreGroup[]) {
  const rows: SearchHit[] = [];
  for (const group of groups) {
    rows.push(...group.items);
  }
  return rows;
}

function ExploreSidebarItem({
  hit,
  active,
  inCart,
  checked,
  onSelect,
  onToggleCheck,
}: {
  hit: SearchHit;
  active: boolean;
  inCart: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleCheck: (e: React.MouseEvent) => void;
}) {
  const badges = hitSourceBadges(hit);
  return (
    <div
      className={cn(
        'flex w-full items-stretch gap-1 rounded-md transition-colors',
        active ? 'list-item-active' : 'border border-transparent hover:bg-surface-tertiary',
      )}
    >
      <button
        type="button"
        className="flex w-8 shrink-0 items-center justify-center text-text-tertiary hover:text-text-primary"
        aria-label={checked ? '取消选中' : '选中表'}
        onClick={onToggleCheck}
      >
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded border',
            checked ? 'border-brand bg-brand text-white' : 'border-border-medium bg-surface-primary',
          )}
        >
          {checked && <Check className="h-3 w-3" />}
        </span>
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-2 text-left"
        onClick={onSelect}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Database className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <span className="truncate font-medium text-text-primary">{hit.tableName}</span>
          {hit.tags.map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {badges.map((source) => (
            <span
              key={source}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] leading-none',
                source === 'live'
                  ? 'bg-brand/15 text-brand'
                  : 'bg-surface-tertiary text-text-secondary',
              )}
            >
              {matchSourceLabel(source)}
            </span>
          ))}
          {inCart && <Check className="ml-auto h-3.5 w-3.5 text-brand" aria-label="已加入导出篮" />}
        </div>
      </button>
    </div>
  );
}

function ExploreSchemaGroup({
  group,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  isInCart,
  checkedIds,
  onToggleCheck,
}: {
  group: ExploreGroup;
  expanded: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  isInCart: (id: number) => boolean;
  checkedIds: Set<number>;
  onToggleCheck: (id: number) => void;
}) {
  const tables = group.items.slice().sort((a, b) => a.tableName.localeCompare(b.tableName));

  return (
    <div className="overflow-hidden rounded-lg border border-border-light bg-surface-secondary">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-surface-tertiary/40"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-text-secondary" />
        )}
        {expanded ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-brand" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-brand" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-text-primary">{group.label}</div>
          <div className="mt-0.5 text-xs text-text-tertiary">{group.items.length} 个表</div>
        </div>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-border-light bg-surface-primary px-2 py-2">
          {tables.map((hit) => (
            <ExploreSidebarItem
              key={hit.lightSchemaId!}
              hit={hit}
              active={selectedId === hit.lightSchemaId}
              inCart={isInCart(hit.lightSchemaId!)}
              checked={checkedIds.has(hit.lightSchemaId!)}
              onSelect={() => onSelect(hit.lightSchemaId!)}
              onToggleCheck={(e) => {
                e.stopPropagation();
                onToggleCheck(hit.lightSchemaId!);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SchemaExplorePage() {
  const { state, setExplore, toggleCart, isInCart, removeFromCart } = useUiState();
  const { explore } = state;
  const { showToast } = useToast();
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [quickLoading, setQuickLoading] = React.useState(false);
  const [deepLoading, setDeepLoading] = React.useState(false);
  const [deepProgress, setDeepProgress] = React.useState<DeepProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const searchAbortRef = React.useRef<AbortController | null>(null);
  const [searched, setSearched] = React.useState(false);
  const [hasDeepHits, setHasDeepHits] = React.useState(false);
  const [quickHitCount, setQuickHitCount] = React.useState(0);
  const [schemaTableNames, setSchemaTableNames] = React.useState<string[]>([]);
  const [checkedIds, setCheckedIds] = React.useState<Set<number>>(new Set());
  const [deepConfirm, setDeepConfirm] = React.useState<DeepConfirm | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<CatalogDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [tableSearch, setTableSearch] = React.useState('');
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({});
  const [detailPanel, setDetailPanel] = React.useState<DetailPanel>('schema');
  const [tagEditOpen, setTagEditOpen] = React.useState(false);
  const [editTagIds, setEditTagIds] = React.useState<number[]>([]);
  const [allTags, setAllTags] = React.useState<Tag[]>([]);

  React.useEffect(() => {
    api.listTags().then((r) => {
      if (r.success) setAllTags(r.data || []);
    });
  }, []);

  const validateFilters = () => {
    const q = explore.q.trim();
    if (!q) {
      setError('请输入搜索关键词');
      return null;
    }
    if (!explore.dataSourceId) {
      setError('请选择数据源');
      return null;
    }
    if (!explore.schemaName) {
      setError('请选择 Schema');
      return null;
    }
    return q;
  };

  const applyHits = (hits: SearchHit[]) => {
    setResults(hits);
    const nextExpanded: Record<string, boolean> = {};
    for (const hit of hits) {
      nextExpanded[`${hit.dataSourceId}|${hit.schemaName}`] = true;
    }
    setExpandedGroups(nextExpanded);
    setSelectedId((prev) => {
      if (prev != null && hits.some((hit) => hit.lightSchemaId === prev)) return prev;
      return hits[0]?.lightSchemaId ?? null;
    });
  };

  const mergeHitIntoResults = React.useCallback((hit: SearchHit) => {
    setResults((prev) => mergeSearchHits(prev, [hit]));
    setHasDeepHits(true);
    setExpandedGroups((prev) => ({
      ...prev,
      [`${hit.dataSourceId}|${hit.schemaName}`]: true,
    }));
    setSelectedId((prev) => {
      if (prev != null) return prev;
      return hit.lightSchemaId ?? null;
    });
  }, []);

  const toggleChecked = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runQuickSearch = React.useCallback(async () => {
    const q = validateFilters();
    if (!q) return;

    searchAbortRef.current?.abort();
    const abort = new AbortController();
    searchAbortRef.current = abort;

    const { dataSourceId, schemaName } = explore;
    setError(null);
    setSearched(true);
    setHasDeepHits(false);
    setQuickHitCount(0);
    setDeepProgress(null);
    setDeepConfirm(null);
    setCheckedIds(new Set());
    setResults([]);
    setSelectedId(null);
    setSchemaTableNames([]);
    setQuickLoading(true);

    try {
      const lightRes = await api.searchLightSchemaData({ q, dataSourceId, schemaName });
      if (abort.signal.aborted) return;
      if (!lightRes.success) throw new Error(lightRes.error || '快速找表失败');
      const hits = lightRes.data || [];
      applyHits(hits);
      setQuickHitCount(hits.length);
      setSchemaTableNames(lightRes.meta?.schemaTableNames || []);
    } catch (err: any) {
      if (abort.signal.aborted) return;
      setError(err?.message || String(err));
    } finally {
      if (!abort.signal.aborted) setQuickLoading(false);
    }
  }, [explore]);

  const executeDeepSearch = React.useCallback(async (tableNames: string[]) => {
    const q = validateFilters();
    if (!q) return;
    if (tableNames.length === 0) {
      showToast('没有可扫描的表');
      return;
    }

    searchAbortRef.current?.abort();
    const abort = new AbortController();
    searchAbortRef.current = abort;

    const { dataSourceId, schemaName } = explore;
    setError(null);
    setDeepConfirm(null);
    setDeepLoading(true);
    setDeepProgress({ scanned: 0, total: tableNames.length, currentTable: '', errors: [] });

    let extraHitCount = 0;
    let errorCount = 0;

    try {
      const streamResult = await api.deepSearchLightSchemaDataStream(
        { q, dataSourceId, schemaName, tableNames },
        (event) => {
          if (abort.signal.aborted) return;
          if (event.type === 'start') {
            setDeepProgress({
              scanned: 0,
              total: event.totalTables,
              currentTable: '',
              errors: [],
            });
          } else if (event.type === 'progress') {
            setDeepProgress((prev) => ({
              scanned: event.scanned,
              total: event.total,
              currentTable: event.tableName,
              errors: prev?.errors || [],
            }));
          } else if (event.type === 'hit') {
            extraHitCount += 1;
            mergeHitIntoResults(event.data);
          } else if (event.type === 'table_error') {
            errorCount += 1;
            setDeepProgress((prev) => ({
              scanned: prev?.scanned ?? 0,
              total: prev?.total ?? 0,
              currentTable: prev?.currentTable ?? '',
              errors: [...(prev?.errors || []), { tableName: event.tableName, error: event.error }],
            }));
          }
        },
        abort.signal,
      );

      if (abort.signal.aborted) return;
      if (!streamResult.ok) throw new Error(streamResult.error || '深挖数据失败');

      const suffix = errorCount > 0 ? `，${errorCount} 张表跳过` : '';
      showToast(
        extraHitCount > 0
          ? `深挖额外命中 ${extraHitCount} 张表${suffix}`
          : `深挖未找到额外命中${suffix}`,
      );
    } catch (err: any) {
      if (abort.signal.aborted) return;
      setError(err?.message || String(err));
    } finally {
      if (!abort.signal.aborted) {
        setDeepLoading(false);
        setDeepProgress(null);
      }
    }
  }, [explore, showToast, mergeHitIntoResults]);

  const quickHitTableNames = React.useMemo(() => {
    return new Set(
      results
        .filter((hit) => hit.matches.some((m) => m.matchSource !== 'live'))
        .map((hit) => hit.tableName),
    );
  }, [results]);

  const remainingAfterQuick = React.useMemo(() => {
    return schemaTableNames.filter((name) => !quickHitTableNames.has(name));
  }, [schemaTableNames, quickHitTableNames]);

  const selectedTableNames = React.useMemo(() => {
    return results
      .filter((hit) => hit.lightSchemaId != null && checkedIds.has(hit.lightSchemaId))
      .map((hit) => hit.tableName);
  }, [results, checkedIds]);

  const requestDeepRemaining = () => {
    if (remainingAfterQuick.length === 0) {
      showToast('快速找表已覆盖全部已生成表');
      return;
    }
    setDeepConfirm({ mode: 'remaining', tableNames: remainingAfterQuick });
  };

  const requestDeepSelected = () => {
    if (selectedTableNames.length === 0) {
      showToast('请先勾选要深挖的表');
      return;
    }
    setDeepConfirm({ mode: 'selected', tableNames: selectedTableNames });
  };

  const requestDeepAll = () => {
    if (schemaTableNames.length === 0) {
      showToast('当前 Schema 没有已生成的 LightSchema');
      return;
    }
    setDeepConfirm({ mode: 'all', tableNames: schemaTableNames });
  };

  const lockSingleSchema = Boolean(explore.schemaName);
  const groups = React.useMemo(
    () => buildExploreGroups(results, lockSingleSchema),
    [results, lockSingleSchema],
  );
  const visibleGroups = React.useMemo(() => {
    const needle = tableSearch.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((hit) => hit.tableName.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, tableSearch]);

  const flatVisibleHits = React.useMemo(
    () => flattenExploreHits(visibleGroups),
    [visibleGroups],
  );

  React.useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api.getCatalogItem(selectedId)
      .then((r) => {
        if (!r.success || !r.data) throw new Error(r.error || '加载详情失败');
        setDetail(r.data);
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  React.useEffect(() => {
    const hit = results.find((item) => item.lightSchemaId === selectedId);
    setDetailPanel(hit && hitHasLiveMatch(hit) ? 'data' : 'schema');
  }, [selectedId, results]);

  React.useEffect(() => {
    if (selectedId != null && flatVisibleHits.some((hit) => hit.lightSchemaId === selectedId)) return;
    setSelectedId(flatVisibleHits[0]?.lightSchemaId ?? null);
  }, [flatVisibleHits, selectedId]);

  const parsed = detail ? parseLightSchemaContent(detail.content, detail.tableName) : null;
  const query = explore.q.trim();
  const selectedHit = flatVisibleHits.find((hit) => hit.lightSchemaId === selectedId) || null;
  const selectedHasLiveMatch = selectedHit ? hitHasLiveMatch(selectedHit) : false;
  const dataHighlightColumns = React.useMemo(() => {
    if (!selectedHit || !query) return [];
    const seen = new Set<string>();
    const cols: string[] = [];
    for (const match of selectedHit.matches) {
      const name = match.columnName?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      cols.push(name);
    }
    return cols;
  }, [selectedHit, query]);

  const dataInitialFilters = React.useMemo(() => {
    if (!selectedHit || !query || !selectedHasLiveMatch) return undefined;
    const filters: Record<string, string> = {};
    for (const match of selectedHit.matches) {
      if (match.matchSource === 'live') filters[match.columnName] = query;
    }
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [selectedHit, query, selectedHasLiveMatch]);

  const syncHitFromDetail = (next: CatalogDetail) => {
    setResults((prev) => prev.map((hit) => (
      hit.lightSchemaId === next.id
        ? { ...hit, tags: next.tags, columnCount: next.columnCount }
        : hit
    )));
  };

  const handleSave = async (content: NonNullable<ReturnType<typeof parseLightSchemaContent>>) => {
    if (!detail) throw new Error('未选择表');
    const res = await api.updateCatalogContent(detail.id, content);
    if (!res.success || !res.data) throw new Error(res.error || '保存失败');
    setDetail(res.data);
    syncHitFromDetail(res.data);
  };

  const handleDelete = async () => {
    if (!detail) throw new Error('未选择表');
    const deletedId = detail.id;
    const ordered = flatVisibleHits
      .filter((hit) => hit.lightSchemaId != null)
      .map((hit) => ({ id: hit.lightSchemaId! }));
    const nextId = pickNextCatalogId(ordered, deletedId);

    const res = await api.deleteCatalogItem(deletedId);
    if (!res.success) throw new Error(res.error || '删除失败');

    if (isInCart(deletedId)) removeFromCart(deletedId);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(deletedId);
      return next;
    });
    setResults((prev) => prev.filter((hit) => hit.lightSchemaId !== deletedId));
    setSelectedId(nextId);
  };

  const handleToggleCart = (item: CatalogDetail) => {
    const inCart = isInCart(item.id);
    toggleCart({
      lightSchemaId: item.id,
      dataSourceId: item.dataSourceId,
      dataSourceName: item.dataSourceName,
      schemaName: item.schemaName,
      tableName: item.tableName,
    });
    showToast(inCart ? '已移出导出篮' : '已加入导出篮');
  };

  const openTagEdit = () => {
    if (!detail) return;
    setEditTagIds(detail.tags.map((t) => t.id));
    setTagEditOpen(true);
  };

  const saveTags = async () => {
    if (!detail) return;
    const res = await api.setCatalogTags(detail.id, editTagIds);
    if (!res.success) {
      setError(res.error || '保存标签失败');
      showToast(res.error || '保存标签失败', 'error');
      return;
    }
    const newTags = allTags.filter((tag) => editTagIds.includes(tag.id));
    const nextDetail = { ...detail, tags: newTags };
    setDetail(nextDetail);
    syncHitFromDetail(nextDetail);
    setTagEditOpen(false);
    showToast('标签保存成功');
  };

  const searching = quickLoading || deepLoading;

  const renderSidebar = () => {
    if (lockSingleSchema) {
      const items = visibleGroups[0]?.items.slice().sort((a, b) => a.tableName.localeCompare(b.tableName)) || [];
      if (items.length === 0) {
        return <div className="py-8 text-center text-sm text-text-secondary">无匹配表</div>;
      }
      return (
        <div className="space-y-1">
          {items.map((hit) => (
            <ExploreSidebarItem
              key={hit.lightSchemaId!}
              hit={hit}
              active={selectedId === hit.lightSchemaId}
              inCart={isInCart(hit.lightSchemaId!)}
              checked={checkedIds.has(hit.lightSchemaId!)}
              onSelect={() => setSelectedId(hit.lightSchemaId!)}
              onToggleCheck={(e) => {
                e.stopPropagation();
                toggleChecked(hit.lightSchemaId!);
              }}
            />
          ))}
        </div>
      );
    }

    if (visibleGroups.length === 0) {
      return <div className="py-8 text-center text-sm text-text-secondary">无匹配表</div>;
    }

    return (
      <div className="space-y-2">
        {visibleGroups.map((group) => (
          <ExploreSchemaGroup
            key={group.key}
            group={group}
            expanded={expandedGroups[group.key] !== false}
            onToggle={() => setExpandedGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
            selectedId={selectedId}
            onSelect={setSelectedId}
            isInCart={isInCart}
            checkedIds={checkedIds}
            onToggleCheck={toggleChecked}
          />
        ))}
      </div>
    );
  };

  const renderDeepProgress = () => {
    if (!deepLoading || !deepProgress) return null;
    const { scanned, total, currentTable, errors } = deepProgress;
    const pct = total > 0 ? Math.round((scanned / total) * 100) : 0;
    return (
      <div className="shrink-0 border-b border-border-light bg-surface-secondary px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
          <span>
            深挖数据 {scanned}/{total}
            {currentTable ? ` · 当前 ${currentTable}` : ''}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {errors.length > 0 && (
          <p className="mt-2 text-xs text-amber-600">
            {errors.length} 张表扫描失败（如远程表已删除）
          </p>
        )}
      </div>
    );
  };

  const renderDeepActions = () => {
    if (!searched || quickLoading || deepLoading) return null;
    const totalGenerated = schemaTableNames.length;
    return (
      <div className="shrink-0 border-b border-border-light bg-surface-secondary px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 text-sm text-text-secondary">
            {results.length > 0 ? (
              <>
                快速找表命中 <span className="font-medium text-text-primary">{quickHitCount}</span> 张表
                {results.length > quickHitCount && (
                  <> · 合计 <span className="font-medium text-text-primary">{results.length}</span> 张</>
                )}
                {totalGenerated > 0 && (
                  <> · 当前 Schema 已生成 <span className="font-medium text-text-primary">{totalGenerated}</span> 张表</>
                )}
                {hasDeepHits && <span className="ml-2 text-brand">· 含实际数据命中</span>}
              </>
            ) : (
              <>
                未在 LightSchema 中找到
                {totalGenerated > 0 && (
                  <> · 当前 Schema 已生成 <span className="font-medium text-text-primary">{totalGenerated}</span> 张表</>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {results.length === 0 && totalGenerated > 0 && (
              <Button variant="primary" className="px-3 py-1.5 text-sm" onClick={requestDeepAll} disabled={searching}>
                深挖全部已生成表（{totalGenerated}）
              </Button>
            )}
            {results.length > 0 && remainingAfterQuick.length > 0 && (
              <Button variant="primary" className="px-3 py-1.5 text-sm" onClick={requestDeepRemaining} disabled={searching}>
                深挖未命中的 {remainingAfterQuick.length} 张表
              </Button>
            )}
            {checkedIds.size > 0 && (
              <Button variant="neutral" className="px-3 py-1.5 text-sm" onClick={requestDeepSelected} disabled={searching}>
                深挖选中表（{checkedIds.size}）
              </Button>
            )}
            {results.length > 0 && checkedIds.size === 0 && remainingAfterQuick.length > 0 && (
              <span className="text-xs text-text-tertiary">勾选左侧表后可只深挖选中表</span>
            )}
          </div>
        </div>
        {(remainingAfterQuick.length > 0 || (results.length === 0 && totalGenerated > 0)) && (
          <p className="mt-2 text-xs text-text-tertiary">
            深挖会连接数据库扫描文本列，耗时较长；适合快速找表不够用时再确认。
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-text-primary">找表</h2>
        <p className="mt-1 text-sm text-text-secondary">
          先快速找候选表，再按需深挖实际数据。须先在工作台生成 LightSchema。
        </p>
      </div>

      {error && (
        <div className="mb-4">
          <StatusBanner tone="error" title="操作失败" message={error} />
        </div>
      )}

      <div className="mb-4 space-y-4 rounded-lg border border-border-light bg-surface-primary p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            className="input flex-1"
            value={explore.q}
            onChange={(e) => setExplore({ q: e.target.value })}
            placeholder="搜索表名、列名、列注释、采样值，例如：贷款、OWNER、居民数"
            onKeyDown={(e) => { if (e.key === 'Enter') runQuickSearch(); }}
          />
          <Button variant="primary" className="px-4 py-2 shrink-0" disabled={searching} onClick={runQuickSearch}>
            <Search className="h-4 w-4" />
            {quickLoading ? '搜索中…' : '快速搜索'}
          </Button>
        </div>
        <FilterBar
          dataSourceId={explore.dataSourceId}
          schemaName={explore.schemaName}
          tagIds={[]}
          showTags={false}
          requireSchema
          onDataSourceChange={(v) => setExplore({ dataSourceId: v })}
          onSchemaChange={(v) => setExplore({ schemaName: v })}
          onTagIdsChange={() => {}}
        />
        <p className="text-xs text-text-tertiary">
          快速找表不连接数据库，仅搜索已生成 LightSchema 的表名、列名、注释与采样值。
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-light bg-surface-primary">
        {!searched ? (
          <div className="flex flex-1 items-center justify-center text-text-secondary">输入关键词，先快速找表</div>
        ) : quickLoading && results.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-text-secondary">快速找表中…</div>
        ) : results.length === 0 && deepLoading ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderDeepProgress()}
            <div className="flex flex-1 items-center justify-center text-text-secondary">深挖数据中，等待命中…</div>
          </div>
        ) : results.length === 0 && !searching ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderDeepActions()}
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-text-secondary">
              <p>未在 LightSchema 中找到匹配表</p>
              {schemaTableNames.length > 0 ? (
                <p className="text-sm text-text-tertiary">
                  可深挖已生成表的实际文本数据（将扫描 {schemaTableNames.length} 张表）
                </p>
              ) : (
                <p className="text-sm text-text-tertiary">请先在工作台为该 Schema 生成 LightSchema</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-[48rem] min-h-0 flex-col overflow-hidden">
            {renderDeepProgress()}
            {renderDeepActions()}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <CatalogTableSidebar
                tableSearch={tableSearch}
                onTableSearchChange={setTableSearch}
                emptyMessage={
                  flatVisibleHits.length === 0 ? (
                    <div className="py-8 text-center text-sm text-text-secondary">无匹配表</div>
                  ) : undefined
                }
                footer={(
                  <>
                    共 {flatVisibleHits.length} 张表
                    {checkedIds.size > 0 && <span className="ml-2">· 已选 {checkedIds.size}</span>}
                    {hasDeepHits && <span className="ml-2">· 含实际数据</span>}
                  </>
                )}
              >
                {renderSidebar()}
              </CatalogTableSidebar>

              <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {detailLoading ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">加载表详情…</div>
                ) : !detail || !parsed ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">请从左侧选择一张表</div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="shrink-0 border-b border-border-light bg-surface-secondary px-6 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="truncate text-xl font-semibold text-text-primary">
                              {detail.dataSourceName} / {detail.schemaName}.{detail.tableName}
                            </h3>
                            {detail.tags.length > 0 ? (
                              detail.tags.map((tag) => (
                                <button
                                  key={tag.id}
                                  type="button"
                                  className="inline-flex cursor-pointer border-0 bg-transparent p-0 transition-opacity hover:opacity-80"
                                  title="点击编辑标签"
                                  aria-label={`编辑标签 ${tag.name}`}
                                  onClick={openTagEdit}
                                >
                                  <TagBadge tag={tag} />
                                </button>
                              ))
                            ) : (
                              <Button variant="neutral" className="px-2 py-1 text-xs" onClick={openTagEdit}>
                                <Tags className="h-3.5 w-3.5" />
                                标签
                              </Button>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                            <span>{parsed.columns.length} 列</span>
                            {selectedHit && (
                              <>
                                <span>·</span>
                                <span>
                                  命中 {selectedHit.matches.filter((m) => m.columnName).length || selectedHit.matches.length} 处
                                </span>
                              </>
                            )}
                            {parsed.primaryKeys && parsed.primaryKeys.length > 0 && (
                              <>
                                <span>·</span>
                                <span>主键 {parsed.primaryKeys.join(', ')}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="flex rounded-lg border border-border-light bg-surface-primary p-0.5">
                            <button
                              type="button"
                              className={cn(
                                'rounded-md px-3 py-1.5 text-sm transition-colors',
                                detailPanel === 'schema'
                                  ? 'bg-surface-tertiary font-medium text-text-primary'
                                  : 'text-text-secondary hover:text-text-primary',
                              )}
                              onClick={() => setDetailPanel('schema')}
                            >
                              列详情
                            </button>
                            <button
                              type="button"
                              className={cn(
                                'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors',
                                detailPanel === 'data'
                                  ? 'bg-surface-tertiary font-medium text-text-primary'
                                  : 'text-text-secondary hover:text-text-primary',
                              )}
                              onClick={() => setDetailPanel('data')}
                            >
                              <Table2 className="h-3.5 w-3.5" />
                              查看数据
                            </button>
                          </div>
                          <Button
                            variant={isInCart(detail.id) ? 'primary' : 'neutral'}
                            className="px-3 py-2"
                            onClick={() => handleToggleCart(detail)}
                          >
                            <ShoppingCart className="h-4 w-4" />
                            {isInCart(detail.id) ? '移出导出篮' : '加入导出篮'}
                          </Button>
                        </div>
                      </div>
                    </div>
                    {selectedHit && selectedHit.matches.length > 0 && (
                      <div className="shrink-0 border-b border-border-light bg-surface-primary px-6 py-3">
                        <div className="text-xs font-medium text-text-secondary">命中来源</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedHit.matches.map((match, idx) => (
                            <span
                              key={`${match.columnName}-${match.matchSource}-${idx}`}
                              className="inline-flex items-center gap-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary"
                            >
                              {match.columnName || match.snippet || '表'}
                              <span className="text-text-tertiary">
                                ({matchSourceLabel(match.matchSource)})
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-4 pt-4">
                      {detailPanel === 'data' ? (
                        <TableDataPreviewPanel
                          key={detail.id}
                          catalogId={detail.id}
                          detail={detail}
                          open
                          variant="inline"
                          initialFilters={dataInitialFilters}
                          highlightQuery={query}
                          priorityColumns={dataHighlightColumns}
                        />
                      ) : (
                        <LightSchemaEditor
                          key={detail.id}
                          content={parsed}
                          ddlText={detail.ddlText}
                          showSamples
                          showDdlTab
                          highlightQuery={query}
                          highlightMeta
                          highlightSamples
                          onSave={handleSave}
                          onDelete={handleDelete}
                        />
                      )}
                    </div>
                  </div>
                )}
              </main>
            </div>
          </div>
        )}
      </div>

      {deepConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDeepConfirm(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border-light bg-surface-primary p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-text-primary">确认深挖数据</h3>
            <p className="mt-2 text-sm text-text-secondary">
              将扫描 <span className="font-medium text-text-primary">{deepConfirm.tableNames.length}</span> 张表的文本列，可能耗时较长。是否继续？
            </p>
            <p className="mt-2 text-xs text-text-tertiary">
              {deepConfirm.mode === 'selected'
                ? '只扫描勾选的表，适合精确确认。'
                : deepConfirm.mode === 'all'
                  ? '快速找表无命中，将扫描当前 Schema 全部已生成表。'
                  : '在未命中的已生成表中扫描实际文本数据。'}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="neutral" onClick={() => setDeepConfirm(null)}>取消</Button>
              <Button
                variant="primary"
                onClick={() => executeDeepSearch(deepConfirm.tableNames)}
              >
                继续深挖
              </Button>
            </div>
          </div>
        </div>
      )}

      {tagEditOpen && detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setTagEditOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border-light bg-surface-primary p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-text-primary">编辑标签</h3>
            <p className="mt-1 text-sm text-text-secondary">
              {detail.schemaName}.{detail.tableName} · 点击标签切换选中，保存后立即显示
            </p>
            <div className="mt-4">
              <TagPicker tags={allTags} value={editTagIds} onChange={setEditTagIds} />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="neutral" onClick={() => setTagEditOpen(false)}>取消</Button>
              <Button variant="primary" onClick={saveTags}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
