import React from 'react';
import { Download, Trash2, X } from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import StatusBanner from '../components/StatusBanner';
import TagPicker from '../components/TagPicker';
import { useUiState } from '../context/UiStateProvider';
import { useToast } from '../context/ToastProvider';
import { ExportCartItem, Tag } from '../lib/uiState';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const { showToast } = useToast();

  React.useEffect(() => {
    api.listTags().then((r) => { if (r.success) setTags(r.data || []); });
  }, []);

  const addByTags = async () => {
    if (exportCart.tagIds.length === 0) {
      setError('请先选择至少一个标签');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await api.listCatalog({ tagIds: exportCart.tagIds });
    setLoading(false);
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

  const handleExport = async () => {
    const items = exportCart.items.map((item) => ({ lightSchemaId: item.lightSchemaId }));
    if (items.length === 0 && exportCart.tagIds.length === 0) {
      setError('导出篮为空，请先加入表或选择标签');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.exportCatalogExcel({
        items,
        tagIds: exportCart.tagIds.length ? exportCart.tagIds : undefined,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `导出失败 HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `light-schema-export-${date}.xlsx`);
      setMessage('导出成功');
      showToast('导出成功');
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">导出</h2>
          <p className="mt-1 text-sm text-text-secondary">
            管理导出篮，按标签批量加入或导出 Excel（可跨数据源）
          </p>
        </div>
        <Button variant="primary" className="px-4 py-2" disabled={loading} onClick={handleExport}>
          <Download className="h-4 w-4" />
          导出 Excel
        </Button>
      </div>

      {error && <div className="mb-4"><StatusBanner tone="error" title="操作失败" message={error} /></div>}
      {message && <div className="mb-4"><StatusBanner tone="success" title="完成" message={message} /></div>}

      <div className="mb-4 rounded-lg border border-border-light bg-surface-primary p-4">
        <h3 className="mb-3 text-sm font-medium text-text-primary">按标签一键加入</h3>
        <TagPicker tags={tags} value={exportCart.tagIds} onChange={setExportTagIds} />
        <div className="mt-4">
          <Button variant="neutral" className="px-3 py-2" disabled={loading} onClick={addByTags}>
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
                  <span className="text-sm text-text-primary">
                    {item.dataSourceName} / {item.schemaName}.{item.tableName}
                  </span>
                  <Button variant="neutral" className="px-2 py-1" onClick={() => removeFromCart(item.lightSchemaId)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
