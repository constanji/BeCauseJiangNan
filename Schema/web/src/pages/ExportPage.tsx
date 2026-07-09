import React from 'react';
import { Download, Trash2, X } from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import StatusBanner from '../components/StatusBanner';
import TagPicker from '../components/TagPicker';
import { useUiState } from '../context/UiStateProvider';
import { useToast } from '../context/ToastProvider';
import { ExportCartItem, Tag } from '../lib/uiState';

type ExportMode = 'light_schema' | 'table_data';

type SkippedExportItem = {
  tableName?: string;
  dataSourceName?: string;
  error?: string;
};

const EXPORT_MODE_LABEL: Record<ExportMode, string> = {
  light_schema: 'LightSchema 导出',
  table_data: '全表导出',
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseContentDispositionFilename(header: string | null) {
  if (!header) return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || null;
}

function fallbackFilename(mode: ExportMode, tableName?: string) {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = mode === 'table_data' ? 'table-data' : 'light-schema';
  const suffix = tableName ? `-${tableName}` : '';
  return `${prefix}${suffix}-${date}.xlsx`;
}

function parseExportSkipped(header: string | null): SkippedExportItem[] {
  if (!header) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatSkippedExportMessage(skipped: SkippedExportItem[]) {
  return skipped
    .map((item) => {
      const table = [item.dataSourceName, item.tableName].filter(Boolean).join(' / ') || '未知表';
      return `${table}: ${item.error || '未知错误'}`;
    })
    .join('\n');
}

export default function ExportPage() {
  const {
    state,
    setExportTagIds,
    removeFromCart,
    clearCart,
    addToCart,
  } = useUiState();
  const { exportCart } = state;

  const [tags, setTags] = React.useState<Tag[]>([]);
  const [loadingMode, setLoadingMode] = React.useState<ExportMode | null>(null);
  const [exportingId, setExportingId] = React.useState<number | null>(null);
  const [exportMenuId, setExportMenuId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const { showToast } = useToast();
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    api.listTags().then((r) => { if (r.success) setTags(r.data || []); });
  }, []);

  React.useEffect(() => {
    if (exportMenuId == null) return undefined;
    const onClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setExportMenuId(null);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [exportMenuId]);

  const addByTags = async () => {
    if (exportCart.tagIds.length === 0) {
      setError('请先选择至少一个标签');
      return;
    }
    setLoadingMode('light_schema');
    setError(null);
    const res = await api.listCatalog({ tagIds: exportCart.tagIds });
    setLoadingMode(null);
    if (!res.success) {
      setError(res.error || '加载标签关联表失败');
      return;
    }
    const cartItems: ExportCartItem[] = (res.data || []).map((item) => ({
      lightSchemaId: item.id,
      dataSourceId: item.dataSourceId,
      dataSourceName: item.dataSourceName,
      schemaName: item.schemaName,
      tableName: item.tableName,
    }));
    addToCart(cartItems);
    const msg = `已加入 ${cartItems.length} 张表`;
    setMessage(`${msg}（含重复去重）`);
    showToast(msg);
  };

  const runExport = async ({
    items,
    mode,
    tableName,
    tagIds,
  }: {
    items: Array<{ lightSchemaId: number }>;
    mode: ExportMode;
    tableName?: string;
    tagIds?: number[];
  }) => {
    setError(null);
    setMessage(null);
    setWarning(null);
    try {
      const res = await api.exportCatalogExcel({ items, tagIds, mode });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `导出失败 HTTP ${res.status}`);
      }

      const responseMode = res.headers.get('X-Export-Mode');
      if (responseMode && responseMode !== mode) {
        throw new Error('服务端未识别导出模式，请重新构建并重启 Schema 服务后再试');
      }
      if (!responseMode) {
        throw new Error('当前 Schema 服务版本过旧，不支持全表导出，请重新构建并重启后再试');
      }

      const blob = await res.blob();
      const filename = parseContentDispositionFilename(res.headers.get('Content-Disposition'))
        || fallbackFilename(mode, tableName);
      downloadBlob(blob, filename);

      const skipped = parseExportSkipped(res.headers.get('X-Export-Skipped'));
      const msg = `${EXPORT_MODE_LABEL[mode]}成功`;
      setMessage(msg);
      showToast(msg);
      if (skipped.length > 0) {
        const warnMsg = `${skipped.length} 张表导出失败或被跳过：\n${formatSkippedExportMessage(skipped)}`;
        setWarning(warnMsg);
        showToast(`部分表未导出（${skipped.length} 张）`);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const handleBatchExport = async (mode: ExportMode) => {
    const items = exportCart.items.map((item) => ({ lightSchemaId: item.lightSchemaId }));
    if (items.length === 0 && exportCart.tagIds.length === 0) {
      setError('导出篮为空，请先加入表或选择标签');
      return;
    }
    setExportMenuId(null);
    setLoadingMode(mode);
    await runExport({
      items,
      mode,
      tagIds: exportCart.tagIds.length ? exportCart.tagIds : undefined,
    });
    setLoadingMode(null);
  };

  const handleSingleExport = async (item: ExportCartItem, mode: ExportMode) => {
    setExportMenuId(null);
    setExportingId(item.lightSchemaId);
    await runExport({
      items: [{ lightSchemaId: item.lightSchemaId }],
      mode,
      tableName: item.tableName,
    });
    setExportingId(null);
  };

  const busy = loadingMode != null || exportingId != null;

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">导出</h2>
          <p className="mt-1 text-sm text-text-secondary">
            管理导出篮，按标签批量加入或导出 Excel（可跨数据源）
          </p>
          <p className="mt-2 text-xs text-text-secondary">
            LightSchema 导出 = 列定义、类型、备注；全表导出 = 按 LightSchema 保留列导出全部行数据，并在表头下方附带列备注（审查删除的列不包含）
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="neutral"
            className="px-4 py-2"
            disabled={busy}
            onClick={() => handleBatchExport('table_data')}
          >
            <Download className="h-4 w-4" />
            {loadingMode === 'table_data' ? '全表导出中…' : '批量全表导出'}
          </Button>
          <Button
            variant="primary"
            className="px-4 py-2"
            disabled={busy}
            onClick={() => handleBatchExport('light_schema')}
          >
            <Download className="h-4 w-4" />
            {loadingMode === 'light_schema' ? 'LightSchema 导出中…' : '批量 LightSchema 导出'}
          </Button>
        </div>
      </div>

      {error && <div className="mb-4"><StatusBanner tone="error" title="操作失败" message={error} /></div>}
      {warning && (
        <div className="mb-4">
          <StatusBanner tone="warning" title="部分表未导出" message={<pre className="whitespace-pre-wrap font-sans">{warning}</pre>} />
        </div>
      )}
      {message && <div className="mb-4"><StatusBanner tone="success" title="完成" message={message} /></div>}

      <div className="mb-4 rounded-lg border border-border-light bg-surface-primary p-4">
        <h3 className="mb-3 text-sm font-medium text-text-primary">按标签一键加入</h3>
        <TagPicker tags={tags} value={exportCart.tagIds} onChange={setExportTagIds} />
        <div className="mt-4">
          <Button variant="neutral" className="px-3 py-2" disabled={busy} onClick={addByTags}>
            加入全部带所选标签的表
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border-light bg-surface-primary">
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
          <span className="text-sm font-medium text-text-primary">导出篮 · {exportCart.items.length} 张表</span>
          <Button variant="neutral" className="px-3 py-2 text-red-400" disabled={exportCart.items.length === 0} onClick={clearCart}>
            <Trash2 className="h-4 w-4" />
            清空
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {exportCart.items.length === 0 ? (
            <p className="text-sm text-text-secondary">
              导出篮为空。可在 LightSchema 库主页或搜索页加入表，或使用上方按标签加入。
            </p>
          ) : (
            <div className="space-y-2">
              {exportCart.items.map((item) => (
                <div key={item.lightSchemaId} className="flex items-center justify-between gap-3 rounded-lg border border-border-light px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                    {item.dataSourceName} / {item.schemaName}.{item.tableName}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="relative" ref={exportMenuId === item.lightSchemaId ? menuRef : undefined}>
                      <Button
                        variant="neutral"
                        className="px-2 py-1"
                        disabled={busy}
                        onClick={() => setExportMenuId((prev) => (prev === item.lightSchemaId ? null : item.lightSchemaId))}
                      >
                        <Download className="h-4 w-4" />
                        {exportingId === item.lightSchemaId ? '导出中…' : '导出'}
                      </Button>
                      {exportMenuId === item.lightSchemaId && (
                        <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border-light bg-surface-primary shadow-lg">
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-surface-secondary"
                            onClick={() => handleSingleExport(item, 'light_schema')}
                          >
                            <div className="text-sm font-medium text-text-primary">LightSchema 导出</div>
                            <div className="mt-0.5 text-xs text-text-secondary">导出列定义、类型、备注、采样值</div>
                          </button>
                          <button
                            type="button"
                            className="block w-full border-t border-border-light px-3 py-2 text-left hover:bg-surface-secondary"
                            onClick={() => handleSingleExport(item, 'table_data')}
                          >
                            <div className="text-sm font-medium text-text-primary">全表导出</div>
                            <div className="mt-0.5 text-xs text-text-secondary">按 LightSchema 保留列导出全部行数据，含列备注</div>
                          </button>
                        </div>
                      )}
                    </div>
                    <Button variant="neutral" className="px-2 py-1" onClick={() => removeFromCart(item.lightSchemaId)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
