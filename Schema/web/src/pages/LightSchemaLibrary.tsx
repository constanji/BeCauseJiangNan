import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  FolderOpen,
  ShoppingCart,
  Tags,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import Button from '../components/Button';
import FilterBar from '../components/FilterBar';
import LightSchemaPreviewPanel from '../components/LightSchemaPreviewPanel';
import StatusBanner from '../components/StatusBanner';
import TagBadge from '../components/TagBadge';
import TagPicker from '../components/TagPicker';
import { useUiState } from '../context/UiStateProvider';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import { CatalogDetail, CatalogItem, ExportCartItem, GroupMode } from '../lib/uiState';

type SchemaGroup = {
  key: string;
  schemaName: string;
  dataSourceId: string;
  dataSourceName: string;
  items: CatalogItem[];
};

type DataSourceGroup = {
  key: string;
  dataSourceId: string;
  dataSourceName: string;
  schemas: SchemaGroup[];
  items: CatalogItem[];
};

function buildSchemaGroups(items: CatalogItem[]): SchemaGroup[] {
  const map = new Map<string, SchemaGroup>();
  for (const item of items) {
    const key = `${item.dataSourceId}|${item.schemaName}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        schemaName: item.schemaName,
        dataSourceId: item.dataSourceId,
        dataSourceName: item.dataSourceName,
        items: [],
      });
    }
    map.get(key)!.items.push(item);
  }
  return [...map.values()].sort((a, b) => {
    const ds = a.dataSourceName.localeCompare(b.dataSourceName);
    return ds !== 0 ? ds : a.schemaName.localeCompare(b.schemaName);
  });
}

function buildDataSourceGroups(items: CatalogItem[]): DataSourceGroup[] {
  const map = new Map<string, DataSourceGroup>();
  for (const item of items) {
    if (!map.has(item.dataSourceId)) {
      map.set(item.dataSourceId, {
        key: item.dataSourceId,
        dataSourceId: item.dataSourceId,
        dataSourceName: item.dataSourceName,
        schemas: [],
        items: [],
      });
    }
    map.get(item.dataSourceId)!.items.push(item);
  }
  for (const group of map.values()) {
    group.schemas = buildSchemaGroups(group.items);
  }
  return [...map.values()].sort((a, b) => a.dataSourceName.localeCompare(b.dataSourceName));
}

function CatalogTableRow({
  item,
  isInCart,
  toggleCart,
  onPreview,
  onTagEdit,
  onWorkbench,
  compact = false,
  showSource = false,
}: {
  item: CatalogItem;
  isInCart: (id: number) => boolean;
  toggleCart: (item: ExportCartItem) => void;
  onPreview: (id: number) => void;
  onTagEdit: (item: CatalogItem) => void;
  onWorkbench: (dataSourceId: string) => void;
  compact?: boolean;
  showSource?: boolean;
}) {
  const cartItem: ExportCartItem = {
    lightSchemaId: item.id,
    dataSourceId: item.dataSourceId,
    dataSourceName: item.dataSourceName,
    schemaName: item.schemaName,
    tableName: item.tableName,
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 rounded border border-border-light bg-surface-secondary px-4 py-3.5',
        'cursor-pointer transition-colors hover:border-border-medium hover:bg-surface-tertiary/40',
        compact && 'bg-surface-primary',
      )}
      onClick={() => onPreview(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPreview(item.id);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="checkbox"
            aria-label={`加入导出篮 ${item.tableName}`}
            checked={isInCart(item.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleCart(cartItem)}
            className="checkbox-theme"
          />
          <Database className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <span className="font-medium text-text-primary">{item.tableName}</span>
          {isInCart(item.id) && <span className="text-xs text-brand">已加入导出篮</span>}
        </div>
        {showSource && (
          <div className="mt-1.5 flex flex-wrap gap-2 pl-6">
            <span className="rounded bg-surface-primary px-2 py-0.5 text-xs text-text-secondary">
              数据源: {item.dataSourceName}
            </span>
            <span className="rounded bg-surface-primary px-2 py-0.5 text-xs text-text-secondary">
              schema: {item.schemaName}
            </span>
          </div>
        )}
        <p className="mt-1 pl-6 text-xs text-text-secondary">
          {item.columnCount} 列 · 更新于 {new Date(item.updatedAt).toLocaleString()}
        </p>
      </div>
      <div
        className="flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {item.tags.length > 0 ? (
          item.tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="inline-flex cursor-pointer border-0 bg-transparent p-0 transition-opacity hover:opacity-80"
              title="点击编辑标签"
              aria-label={`编辑标签 ${tag.name}`}
              onClick={() => onTagEdit(item)}
            >
              <TagBadge tag={tag} />
            </button>
          ))
        ) : (
          <Button variant="neutral" className="px-2 py-1 text-xs" onClick={() => onTagEdit(item)}>
            <Tags className="h-3.5 w-3.5" />
            标签
          </Button>
        )}
        <Button variant="neutral" className="px-2 py-1 text-xs" onClick={() => onWorkbench(item.dataSourceId)}>
          Workbench
        </Button>
      </div>
    </div>
  );
}

function SchemaGroupCard({
  group,
  expanded,
  onToggle,
  showDataSource,
  isInCart,
  toggleCart,
  onPreview,
  onTagEdit,
  onWorkbench,
}: {
  group: SchemaGroup;
  expanded: boolean;
  onToggle: () => void;
  showDataSource: boolean;
  isInCart: (id: number) => boolean;
  toggleCart: (item: ExportCartItem) => void;
  onPreview: (id: number) => void;
  onTagEdit: (item: CatalogItem) => void;
  onWorkbench: (dataSourceId: string) => void;
}) {
  const latestUpdate = group.items.reduce((max, item) => (
    item.updatedAt > max ? item.updatedAt : max
  ), group.items[0]?.updatedAt || '');

  return (
    <div className="overflow-hidden rounded-lg border border-border-light bg-surface-secondary transition-colors hover:border-border-medium">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
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
              <h3 className="truncate font-medium text-text-primary">
                {showDataSource ? `${group.dataSourceName} · ${group.schemaName}` : group.schemaName}
              </h3>
              <span className="shrink-0 text-xs text-text-tertiary">({group.items.length} 个表)</span>
            </button>
            <div className="mt-2 flex flex-wrap gap-2 pl-6">
              <span className="rounded bg-surface-primary px-2 py-1 text-xs text-text-secondary">
                数据源: {group.dataSourceName}
              </span>
              <span className="rounded bg-surface-primary px-2 py-1 text-xs text-text-secondary">
                schema: {group.schemaName}
              </span>
            </div>
            {latestUpdate && (
              <p className="mt-2 pl-6 text-xs text-text-tertiary">
                最近更新: {new Date(latestUpdate).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border-light bg-surface-primary px-4 py-3 pl-8">
          <div className="space-y-2">
            {group.items
              .slice()
              .sort((a, b) => a.tableName.localeCompare(b.tableName))
              .map((item) => (
                <CatalogTableRow
                  key={item.id}
                  item={item}
                  compact
                  isInCart={isInCart}
                  toggleCart={toggleCart}
                  onPreview={onPreview}
                  onTagEdit={onTagEdit}
                  onWorkbench={onWorkbench}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LightSchemaLibrary() {
  const nav = useNavigate();
  const {
    state,
    setLibrary,
    addToCart,
    toggleCart,
    isInCart,
  } = useUiState();
  const { library } = state;

  const [items, setItems] = React.useState<CatalogItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<CatalogDetail | null>(null);
  const [tagEditId, setTagEditId] = React.useState<number | null>(null);
  const [editTagIds, setEditTagIds] = React.useState<number[]>([]);
  const [allTags, setAllTags] = React.useState<any[]>([]);
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({});
  const listScrollRef = React.useRef<HTMLDivElement>(null);
  const hasLoadedOnce = React.useRef(false);
  const { showToast } = useToast();

  const reload = React.useCallback(() => {
    setError(null);
    const keepScroll = hasLoadedOnce.current;
    const scrollTop = keepScroll ? listScrollRef.current?.scrollTop ?? 0 : 0;
    if (!hasLoadedOnce.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    api.listCatalog({
      dataSourceId: library.dataSourceId || undefined,
      schemaName: library.schemaName || undefined,
      tagIds: library.tagIds,
      q: library.searchQuery || undefined,
    })
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载失败');
        setItems(r.data || []);
        hasLoadedOnce.current = true;
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
        if (keepScroll && listScrollRef.current) {
          listScrollRef.current.scrollTop = scrollTop;
        }
      });
  }, [library.dataSourceId, library.schemaName, library.tagIds, library.searchQuery]);

  React.useEffect(() => { reload(); }, [reload]);
  React.useEffect(() => {
    api.listTags().then((r) => { if (r.success) setAllTags(r.data || []); });
  }, []);

  React.useEffect(() => {
    if (library.groupMode === 'flat') return;
    const keys = library.groupMode === 'schema'
      ? buildSchemaGroups(items).map((g) => g.key)
      : buildDataSourceGroups(items).flatMap((g) => g.schemas.map((s) => s.key));
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        if (next[key] === undefined) next[key] = true;
      }
      return next;
    });
  }, [items, library.groupMode]);

  const openPreview = async (id: number) => {
    const res = await api.getCatalogItem(id);
    if (!res.success || !res.data) {
      setError(res.error || '加载详情失败');
      return;
    }
    setPreview(res.data);
  };

  const openTagEdit = (item: CatalogItem) => {
    setTagEditId(item.id);
    setEditTagIds(item.tags.map((t) => t.id));
  };

  const saveTags = async () => {
    if (tagEditId == null) return;
    const res = await api.setCatalogTags(tagEditId, editTagIds);
    if (!res.success) {
      setError(res.error || '保存标签失败');
      showToast(res.error || '保存标签失败', 'error');
      return;
    }
    const newTags = allTags.filter((tag) => editTagIds.includes(tag.id));
    setItems((prev) => prev.map((item) => (
      item.id === tagEditId ? { ...item, tags: newTags } : item
    )));
    setTagEditId(null);
    showToast('标签保存成功');
  };

  const addAllFiltered = () => {
    const cartItems: ExportCartItem[] = items.map((item) => ({
      lightSchemaId: item.id,
      dataSourceId: item.dataSourceId,
      dataSourceName: item.dataSourceName,
      schemaName: item.schemaName,
      tableName: item.tableName,
    }));
    addToCart(cartItems);
    showToast(`已加入 ${cartItems.length} 张表到导出篮`);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const showDataSourceInSchema = !library.dataSourceId;
  const schemaGroups = buildSchemaGroups(items);
  const dataSourceGroups = buildDataSourceGroups(items);

  const rowProps = {
    isInCart,
    toggleCart,
    onPreview: openPreview,
    onTagEdit: openTagEdit,
    onWorkbench: (dataSourceId: string) => nav(`/workbench/${dataSourceId}`),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">LightSchema 库</h2>
          <p className="mt-1 text-sm text-text-secondary">查看已生成的表结构，可按数据源 / Schema / 标签筛选</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="neutral" className="px-3 py-2" onClick={addAllFiltered} disabled={items.length === 0}>
            <ShoppingCart className="h-4 w-4" />
            当前结果加入导出篮
          </Button>
        </div>
      </div>

      {error && <div className="mb-4"><StatusBanner tone="error" title="操作失败" message={error} /></div>}

      <div className="mb-4 space-y-4 rounded-lg border border-border-light bg-surface-primary p-4">
        <FilterBar
          dataSourceId={library.dataSourceId}
          schemaName={library.schemaName}
          tagIds={library.tagIds}
          onDataSourceChange={(v) => setLibrary({ dataSourceId: v })}
          onSchemaChange={(v) => setLibrary({ schemaName: v })}
          onTagIdsChange={(ids) => setLibrary({ tagIds: ids })}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">内容搜索</span>
            <input
              className="input"
              value={library.searchQuery}
              onChange={(e) => setLibrary({ searchQuery: e.target.value })}
              placeholder="表名、列备注等，如：账户ID"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">分组方式</span>
            <select
              className="input"
              value={library.groupMode}
              onChange={(e) => setLibrary({ groupMode: e.target.value as GroupMode })}
            >
              <option value="schema">按 Schema（层级）</option>
              <option value="dataSource">按数据源（层级）</option>
              <option value="flat">平铺</option>
            </select>
          </label>
        </div>
      </div>

      <div ref={listScrollRef} className="relative flex-1 overflow-auto">
        {refreshing && items.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-brand/80" />
        )}
        {loading ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">暂无已生成的 LightSchema</div>
        ) : library.groupMode === 'flat' ? (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border border-border-light bg-surface-primary p-4">
                <CatalogTableRow item={item} showSource {...rowProps} />
              </div>
            ))}
          </div>
        ) : library.groupMode === 'schema' ? (
          <div className="space-y-3">
            {schemaGroups.map((group) => (
              <SchemaGroupCard
                key={group.key}
                group={group}
                expanded={expandedGroups[group.key] !== false}
                onToggle={() => toggleGroup(group.key)}
                showDataSource={showDataSourceInSchema}
                {...rowProps}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {dataSourceGroups.map((dsGroup) => (
              <div key={dsGroup.key} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <Database className="h-4 w-4 text-brand" />
                  <h3 className="text-sm font-semibold text-text-primary">
                    {dsGroup.dataSourceName}
                  </h3>
                  <span className="text-xs text-text-tertiary">
                    ({dsGroup.items.length} 张表 · {dsGroup.schemas.length} 个 Schema)
                  </span>
                </div>
                <div className="space-y-3 pl-2">
                  {dsGroup.schemas.map((group) => (
                    <SchemaGroupCard
                      key={group.key}
                      group={group}
                      expanded={expandedGroups[group.key] !== false}
                      onToggle={() => toggleGroup(group.key)}
                      showDataSource={false}
                      {...rowProps}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <LightSchemaPreviewPanel
          item={preview}
          onClose={() => setPreview(null)}
          onUpdated={(next) => {
            setPreview(next);
            setItems((prev) => prev.map((row) => (
              row.id === next.id
                ? { ...row, columnCount: next.columnCount, updatedAt: next.updatedAt, tags: next.tags }
                : row
            )));
          }}
          onDeleted={(id) => {
            setPreview(null);
            setItems((prev) => prev.filter((row) => row.id !== id));
          }}
        />
      )}

      {tagEditId != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setTagEditId(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border-light bg-surface-primary p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-text-primary">编辑标签</h3>
            <p className="mt-1 text-sm text-text-secondary">点击标签切换选中，保存后立即显示在表行上</p>
            <div className="mt-4">
              <TagPicker tags={allTags} value={editTagIds} onChange={setEditTagIds} />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="neutral" onClick={() => setTagEditId(null)}>取消</Button>
              <Button variant="primary" onClick={saveTags}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
