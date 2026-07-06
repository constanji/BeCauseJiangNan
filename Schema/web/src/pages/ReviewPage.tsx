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
import { HideInCartToggle } from '../components/ToggleSwitch';
import LightSchemaEditor from '../components/LightSchemaEditor';
import StatusBanner from '../components/StatusBanner';
import TagBadge from '../components/TagBadge';
import TagPicker from '../components/TagPicker';
import TableDataPreviewPanel from '../components/TableDataPreviewPanel';
import { useUiState } from '../context/UiStateProvider';
import { useToast } from '../context/ToastProvider';
import { buildDataSourceGroups, buildSchemaGroups } from '../lib/catalogGroups';
import { cn } from '../lib/cn';
import { parseLightSchemaContent } from '../lib/lightSchemaTypes';
import { flattenReviewSidebarTables, pickNextCatalogId } from '../lib/reviewNav';
import { CatalogDetail, CatalogItem, ExportCartItem, Tag } from '../lib/uiState';

function toCartItem(item: CatalogItem): ExportCartItem {
  return {
    lightSchemaId: item.id,
    dataSourceId: item.dataSourceId,
    dataSourceName: item.dataSourceName,
    schemaName: item.schemaName,
    tableName: item.tableName,
  };
}

function ReviewTableItem({
  item,
  active,
  inCart,
  onSelect,
}: {
  item: CatalogItem;
  active: boolean;
  inCart: boolean;
  onSelect: () => void;
}) {
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
        <span className="truncate font-medium text-text-primary">{item.tableName}</span>
        {item.tags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {inCart && (
          <Check className="h-4 w-4 text-brand" aria-label="已加入导出篮" />
        )}
        <span className="text-xs text-text-tertiary">{item.columnCount} 列</span>
      </div>
    </button>
  );
}

function ReviewSchemaGroup({
  group,
  expanded,
  onToggle,
  showDataSource,
  selectedId,
  onSelect,
  tableSearch,
  isInCart,
}: {
  group: ReturnType<typeof buildSchemaGroups>[number];
  expanded: boolean;
  onToggle: () => void;
  showDataSource: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  tableSearch: string;
  isInCart: (id: number) => boolean;
}) {
  const tables = group.items
    .filter((item) => item.tableName.toLowerCase().includes(tableSearch.toLowerCase()))
    .sort((a, b) => a.tableName.localeCompare(b.tableName));

  if (tables.length === 0 && tableSearch) return null;

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
          <div className="truncate font-medium text-text-primary">
            {showDataSource ? `${group.dataSourceName} · ${group.schemaName}` : group.schemaName}
          </div>
          <div className="mt-0.5 text-xs text-text-tertiary">{group.items.length} 个表</div>
        </div>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-border-light bg-surface-primary px-2 py-2">
          {tables.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-text-tertiary">暂无表</p>
          ) : (
            tables.map((item) => (
              <ReviewTableItem
                key={item.id}
                item={item}
                active={selectedId === item.id}
                inCart={isInCart(item.id)}
                onSelect={() => onSelect(item.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ReviewPage({ cartOnly = false }: { cartOnly?: boolean }) {
  const { state, setReview, isInCart, toggleCart, removeFromCart } = useUiState();
  const { columnSearchQuery, hideInCart } = state.review;
  const cartCount = state.exportCart.items.length;
  const { showToast } = useToast();
  const [dataSourceId, setDataSourceId] = React.useState('');
  const [schemaName, setSchemaName] = React.useState('');
  const [tagIds, setTagIds] = React.useState<number[]>([]);
  const [tableSearch, setTableSearch] = React.useState('');
  const [items, setItems] = React.useState<CatalogItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<CatalogDetail | null>(null);
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tagEditOpen, setTagEditOpen] = React.useState(false);
  const [viewDataOpen, setViewDataOpen] = React.useState(false);
  const [editTagIds, setEditTagIds] = React.useState<number[]>([]);
  const [allTags, setAllTags] = React.useState<Tag[]>([]);

  React.useEffect(() => {
    api.listTags().then((r) => {
      if (r.success) setAllTags(r.data || []);
    });
  }, []);

  const reload = React.useCallback(() => {
    if (cartOnly && cartCount === 0) {
      setItems([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api.listCatalog({
      dataSourceId: dataSourceId || undefined,
      schemaName: schemaName || undefined,
      tagIds,
      q: columnSearchQuery.trim() || undefined,
    })
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载失败');
        let rows = r.data || [];
        if (cartOnly) {
          rows = rows.filter((row) => isInCart(row.id));
        }
        setItems(rows);
        setSelectedId((prev) => {
          if (prev != null && rows.some((row) => row.id === prev)) return prev;
          return rows[0]?.id ?? null;
        });
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [cartOnly, cartCount, dataSourceId, schemaName, tagIds, columnSearchQuery, isInCart]);

  React.useEffect(() => { reload(); }, [reload]);

  const visibleItems = React.useMemo(() => {
    if (cartOnly) return items.filter((item) => isInCart(item.id));
    return items.filter((item) => !hideInCart || !isInCart(item.id));
  }, [items, cartOnly, hideInCart, isInCart]);

  const showDataSourceInSchema = !dataSourceId;
  const schemaGroups = React.useMemo(() => buildSchemaGroups(visibleItems), [visibleItems]);
  const dataSourceGroups = React.useMemo(() => buildDataSourceGroups(visibleItems), [visibleItems]);
  const nestedSidebar = showDataSourceInSchema && dataSourceGroups.length > 1;

  React.useEffect(() => {
    if (!cartOnly) return;
    setItems((prev) => prev.filter((item) => isInCart(item.id)));
  }, [cartOnly, state.exportCart.items, isInCart]);

  React.useEffect(() => {
    if (selectedId != null && visibleItems.some((row) => row.id === selectedId)) return;
    const ordered = flattenReviewSidebarTables(visibleItems, tableSearch, nestedSidebar);
    setSelectedId(ordered[0]?.id ?? visibleItems[0]?.id ?? null);
  }, [visibleItems, selectedId, tableSearch, nestedSidebar]);

  React.useEffect(() => {
    if (!columnSearchQuery.trim()) return;
    const keys = buildSchemaGroups(visibleItems).map((g) => g.key);
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = true;
      return next;
    });
  }, [columnSearchQuery, visibleItems]);

  React.useEffect(() => {
    setViewDataOpen(false);
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

  const parsed = detail ? parseLightSchemaContent(detail.content, detail.tableName) : null;

  const handleSave = async (content: NonNullable<ReturnType<typeof parseLightSchemaContent>>) => {
    if (!detail) throw new Error('未选择表');
    const res = await api.updateCatalogContent(detail.id, content);
    if (!res.success || !res.data) throw new Error(res.error || '保存失败');
    setDetail(res.data);
    setItems((prev) => prev.map((row) => (
      row.id === res.data!.id
        ? {
          ...row,
          columnCount: res.data!.columnCount,
          updatedAt: res.data!.updatedAt,
          tags: res.data!.tags,
        }
        : row
    )));
  };

  const handleDelete = async () => {
    if (!detail) throw new Error('未选择表');
    const deletedId = detail.id;
    const ordered = flattenReviewSidebarTables(visibleItems, tableSearch, nestedSidebar);
    const nextId = pickNextCatalogId(ordered, deletedId);

    const res = await api.deleteCatalogItem(deletedId);
    if (!res.success) throw new Error(res.error || '删除失败');

    if (isInCart(deletedId)) removeFromCart(deletedId);
    setItems((prev) => prev.filter((row) => row.id !== deletedId));
    setSelectedId(nextId);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleCart = (item: CatalogItem) => {
    const inCart = isInCart(item.id);
    toggleCart(toCartItem(item));
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
    setDetail((prev) => (prev ? { ...prev, tags: newTags } : prev));
    setItems((prev) => prev.map((item) => (
      item.id === detail.id ? { ...item, tags: newTags } : item
    )));
    setTagEditOpen(false);
    showToast('标签保存成功');
  };

  const renderSidebarGroups = () => {
    if (showDataSourceInSchema && dataSourceGroups.length > 1) {
      return (
        <div className="space-y-4">
          {dataSourceGroups.map((dsGroup) => (
            <div key={dsGroup.key} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Database className="h-4 w-4 text-brand" />
                <span className="text-sm font-semibold text-text-primary">{dsGroup.dataSourceName}</span>
                <span className="text-xs text-text-tertiary">({dsGroup.items.length} 张表)</span>
              </div>
              <div className="space-y-2 pl-1">
                {dsGroup.schemas.map((group) => (
                  <ReviewSchemaGroup
                    key={group.key}
                    group={group}
                    expanded={expandedGroups[group.key] === true}
                    onToggle={() => toggleGroup(group.key)}
                    showDataSource={false}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    tableSearch={tableSearch}
                    isInCart={isInCart}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {schemaGroups.map((group) => (
          <ReviewSchemaGroup
            key={group.key}
            group={group}
            expanded={expandedGroups[group.key] === true}
            onToggle={() => toggleGroup(group.key)}
            showDataSource={showDataSourceInSchema}
            selectedId={selectedId}
            onSelect={setSelectedId}
            tableSearch={tableSearch}
            isInCart={isInCart}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="px-4 py-4">
      <div className="mb-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-brand/70">
              {cartOnly ? 'Export Cart' : 'Schema Browser'}
            </p>
            <h2 className="text-xl font-semibold text-text-primary">
              {cartOnly ? '导出篮审查' : '审查 · LightSchema 预览'}
              {!loading && (
                <span className="ml-2 text-base font-normal text-text-secondary">
                  ({visibleItems.length} 张表{columnSearchQuery.trim() ? ' · 已搜索' : ''})
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {cartOnly
                ? '仅审查导出篮中的表，可编辑列备注与采样值'
                : '左侧按 Schema 层级浏览，右侧审查并编辑列备注与采样值'}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3">
          <StatusBanner tone="error" title="操作失败" message={error} />
        </div>
      )}

      <div className="mb-3 space-y-4 rounded-lg border border-border-light bg-surface-primary p-4">
        <FilterBar
          dataSourceId={dataSourceId}
          schemaName={schemaName}
          tagIds={tagIds}
          onDataSourceChange={setDataSourceId}
          onSchemaChange={setSchemaName}
          onTagIdsChange={setTagIds}
        />
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-text-secondary">列名 / 列注释搜索</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
              <input
                className="input py-2 pl-8 pr-8"
                value={columnSearchQuery}
                onChange={(e) => setReview({ columnSearchQuery: e.target.value })}
                placeholder="搜索列名或列注释，例如：account_id、账户"
              />
              {columnSearchQuery && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                  onClick={() => setReview({ columnSearchQuery: '' })}
                  aria-label="清空列注释搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </label>
          {!cartOnly && (
            <HideInCartToggle
              checked={hideInCart}
              onChange={(val) => setReview({ hideInCart: val })}
            />
          )}
        </div>
      </div>

      <div className="flex h-[48rem] overflow-hidden rounded-lg border border-border-light bg-surface-primary">
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
            {loading ? (
              <div className="py-8 text-center text-sm text-text-secondary">加载中…</div>
            ) : visibleItems.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-secondary">
                {cartOnly
                  ? '导出篮为空，请先在主页加入表'
                  : columnSearchQuery.trim()
                    ? '未找到匹配的表'
                    : hideInCart
                      ? '当前筛选下没有可显示的表'
                      : '暂无已生成的 LightSchema'}
              </div>
            ) : (
              renderSidebarGroups()
            )}
          </div>
          <div className="flex min-h-[3rem] shrink-0 items-center border-t border-border-light px-4 py-3 text-xs text-text-tertiary">
            共 {visibleItems.length} 张表
            {hideInCart && items.length !== visibleItems.length && (
              <span className="ml-2 text-text-tertiary">（已隐藏 {items.length - visibleItems.length} 张）</span>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {detailLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">加载表详情…</div>
          ) : !detail || !parsed ? (
            <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">请从左侧选择一张表进行审查</div>
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
                      {parsed.primaryKeys && parsed.primaryKeys.length > 0 && (
                        <>
                          <span>·</span>
                          <span>主键 {parsed.primaryKeys.join(', ')}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="neutral"
                      className="px-3 py-2"
                      onClick={() => setViewDataOpen(true)}
                    >
                      <Table2 className="h-4 w-4" />
                      查看数据
                    </Button>
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-4 pt-4">
                <LightSchemaEditor
                  key={detail.id}
                  content={parsed}
                  ddlText={detail.ddlText}
                  showSamples
                  showDdlTab
                  highlightQuery={columnSearchQuery}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              </div>
            </div>
          )}
        </main>
      </div>

      {viewDataOpen && detail && (
        <TableDataPreviewPanel
          catalogId={detail.id}
          detail={detail}
          open={viewDataOpen}
          onClose={() => setViewDataOpen(false)}
        />
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
