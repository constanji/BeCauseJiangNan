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
  X,
} from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import FilterBar from '../components/FilterBar';
import LightSchemaEditor from '../components/LightSchemaEditor';
import StatusBanner from '../components/StatusBanner';
import TagBadge from '../components/TagBadge';
import TagPicker from '../components/TagPicker';
import TableDataPreviewPanel from '../components/TableDataPreviewPanel';
import ToggleSwitch from '../components/ToggleSwitch';
import { useUiState } from '../context/UiStateProvider';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import { parseLightSchemaContent } from '../lib/lightSchemaTypes';
import { pickNextCatalogId } from '../lib/reviewNav';
import { CatalogDetail, SearchHit, SearchMatch, Tag } from '../lib/uiState';

type ExploreGroup = {
  key: string;
  label: string;
  items: SearchHit[];
};

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
    for (const match of existing.matches) colMap.set(match.columnName, match);
    for (const match of hit.matches) {
      const prev = colMap.get(match.columnName);
      if (!prev || prev.matchSource !== 'live') colMap.set(match.columnName, match);
    }
    map.set(hit.lightSchemaId, { ...existing, matches: [...colMap.values()] });
  }
  return [...map.values()].sort((a, b) => a.tableName.localeCompare(b.tableName, 'zh-CN'));
}

function hitHasLiveMatch(hit: SearchHit) {
  return hit.matches.some((match) => match.matchSource === 'live');
}

function matchSourceLabel(source?: SearchMatch['matchSource']) {
  if (source === 'live') return '深度';
  return '轻量';
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
  onSelect,
}: {
  hit: SearchHit;
  active: boolean;
  inCart: boolean;
  onSelect: () => void;
}) {
  const live = hitHasLiveMatch(hit);
  return (
    <button
      type="button"
      className={cn(
        'flex h-[4.25rem] w-full items-center gap-2 rounded-md px-3 text-left transition-colors',
        active ? 'list-item-active' : 'border border-transparent hover:bg-surface-tertiary',
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Database className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <span className="truncate font-medium text-text-primary">{hit.tableName}</span>
        {hit.tags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} />
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <div className="flex items-center gap-2">
          {inCart && (
            <Check className="h-4 w-4 text-brand" aria-label="已加入导出篮" />
          )}
          <span className="text-xs text-text-tertiary">{hit.columnCount} 列</span>
        </div>
        <span className="text-[11px] text-brand">
          命中 {hit.matches.length} 列{live ? ' · 深度' : ''}
        </span>
      </div>
    </button>
  );
}

function ExploreSchemaGroup({
  group,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  isInCart,
}: {
  group: ExploreGroup;
  expanded: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  isInCart: (id: number) => boolean;
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
              onSelect={() => onSelect(hit.lightSchemaId!)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type DetailPanel = 'schema' | 'data';

export default function SchemaExplorePage() {
  const { state, setExplore, toggleCart, isInCart, removeFromCart } = useUiState();
  const { explore } = state;
  const { showToast } = useToast();
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [searched, setSearched] = React.useState(false);
  const [lastSearchDeep, setLastSearchDeep] = React.useState(false);
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
    if (!explore.searchLight && !explore.searchDeep) {
      setError('请至少开启轻量搜索或深度搜索');
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

  const runSearch = React.useCallback(async () => {
    const q = validateFilters();
    if (!q) return;
    const { searchLight, searchDeep, dataSourceId, schemaName } = explore;
    setLoading(true);
    setError(null);
    setSearched(true);
    setLastSearchDeep(searchDeep);
    try {
      let merged: SearchHit[] = [];
      if (searchLight) {
        const lightRes = await api.searchLightSchemaData({ q, dataSourceId, schemaName });
        if (!lightRes.success) throw new Error(lightRes.error || '轻量搜索失败');
        merged = lightRes.data || [];
      }
      if (searchDeep) {
        const deepRes = await api.deepSearchLightSchemaData({ q, dataSourceId, schemaName });
        if (!deepRes.success) throw new Error(deepRes.error || '深度搜索失败');
        merged = searchLight
          ? mergeSearchHits(merged, deepRes.data || [])
          : (deepRes.data || []);
        const deepCount = deepRes.data?.length || 0;
        if (searchLight) {
          showToast(deepCount > 0 ? `深度搜索额外命中 ${deepCount} 张表` : '深度搜索无额外命中');
        } else if (deepCount === 0) {
          showToast('深度搜索未找到匹配表');
        }
      }
      applyHits(merged);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [explore, showToast]);

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
              onSelect={() => setSelectedId(hit.lightSchemaId!)}
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
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-text-primary">找表</h2>
        <p className="mt-1 text-sm text-text-secondary">
          在已生成 LightSchema 的表中搜索；轻量搜索覆盖列名、注释与采样值，深度搜索连库扫描文本列
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
            placeholder="搜索关键词，例如：贷款、OWNER、居民数"
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          />
          <Button variant="primary" className="px-4 py-2 shrink-0" disabled={loading} onClick={runSearch}>
            <Search className="h-4 w-4" />
            搜索
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <label className="flex cursor-pointer items-center gap-3">
            <ToggleSwitch
              checked={explore.searchLight}
              onChange={(val) => setExplore({ searchLight: val })}
              label="轻量搜索"
            />
            <span className="select-none text-text-secondary">轻量搜索（列名 / 注释 / 采样值）</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <ToggleSwitch
              checked={explore.searchDeep}
              onChange={(val) => setExplore({ searchDeep: val })}
              label="深度搜索"
            />
            <span className="select-none text-text-secondary">深度搜索（连库扫描文本列）</span>
          </label>
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-light bg-surface-primary">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-text-secondary">
            {explore.searchDeep && !explore.searchLight ? '深度搜索中…' : '搜索中…'}
          </div>
        ) : !searched ? (
          <div className="flex flex-1 items-center justify-center text-text-secondary">输入关键词开始找表</div>
        ) : results.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-text-secondary">未找到相关表</div>
        ) : (
          <div className="flex h-[48rem] min-h-0 overflow-hidden">
            <aside className="flex w-80 shrink-0 flex-col border-r border-border-light bg-surface-secondary">
              <div className="shrink-0 border-b border-border-light p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
                  <input
                    className="input py-2 pl-8 pr-8 text-sm"
                    placeholder="搜索表名…"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                  />
                  {tableSearch && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                      onClick={() => setTableSearch('')}
                      aria-label="清空搜索"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {renderSidebar()}
              </div>
              <div className="flex min-h-[3rem] shrink-0 items-center border-t border-border-light px-4 py-3 text-xs text-text-tertiary">
                共 {flatVisibleHits.length} 张表
                {lastSearchDeep && <span className="ml-2">· 含深度搜索</span>}
              </div>
            </aside>

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
                              <span>命中 {selectedHit.matches.length} 列</span>
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
                      <div className="text-xs font-medium text-text-secondary">命中列</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedHit.matches.map((match) => (
                          <span
                            key={match.columnName}
                            className="inline-flex items-center gap-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary"
                          >
                            {match.columnName}
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
                      />
                    ) : (
                      <LightSchemaEditor
                        key={detail.id}
                        content={parsed}
                        ddlText={detail.ddlText}
                        showSamples
                        showDdlTab
                        highlightQuery={query}
                        highlightMeta={explore.searchLight}
                        highlightSamples={explore.searchLight || lastSearchDeep}
                        onSave={handleSave}
                        onDelete={handleDelete}
                      />
                    )}
                  </div>
                </div>
              )}
            </main>
          </div>
        )}
      </div>

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
