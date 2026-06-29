import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import StatusBanner from '../components/StatusBanner';
import { ColorPicker } from '../components/TagPicker';
import { TAG_COLORS, Tag } from '../lib/uiState';
import { useToast } from '../context/ToastProvider';

export default function TagManagement() {
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(TAG_COLORS[0]);
  const [creating, setCreating] = React.useState(false);
  const { showToast } = useToast();

  const reload = React.useCallback(() => {
    setLoading(true);
    setError(null);
    api.listTags()
      .then((r) => {
        if (!r.success) throw new Error(r.error || '加载标签失败');
        setTags(r.data || []);
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { reload(); }, [reload]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入标签名称');
      return;
    }
    setCreating(true);
    setError(null);
    const res = await api.createTag({ name: trimmed, color });
    setCreating(false);
    if (!res.success) {
      setError(res.error || '创建失败');
      showToast(res.error || '创建失败', 'error');
      return;
    }
    setName('');
    reload();
    showToast('标签创建成功');
  };

  const handleDelete = async (tag: Tag) => {
    const msg = tag.usageCount
      ? `删除标签「${tag.name}」将解除 ${tag.usageCount} 张表的关联，确定继续？`
      : `确定删除标签「${tag.name}」？`;
    if (!window.confirm(msg)) return;
    const res = await api.deleteTag(tag.id);
    if (!res.success) {
      setError(res.error || '删除失败');
      showToast(res.error || '删除失败', 'error');
      return;
    }
    reload();
    showToast('标签删除成功');
  };

  const handleColorChange = async (tag: Tag, nextColor: string) => {
    const res = await api.updateTag(tag.id, { color: nextColor });
    if (!res.success) {
      setError(res.error || '更新失败');
      return;
    }
    reload();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-text-primary">标签管理</h2>
        <p className="mt-1 text-sm text-text-secondary">创建全局表级标签，用于筛选、搜索与批量导出</p>
      </div>

      {error && <div className="mb-4"><StatusBanner tone="error" title="操作失败" message={error} /></div>}

      <div className="mb-6 rounded-lg border border-border-light bg-surface-primary p-4">
        <h3 className="mb-3 text-sm font-medium text-text-primary">新建标签</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-text-secondary">名称</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：指标、银行卡" />
          </label>
          <div>
            <span className="mb-1 block text-sm text-text-secondary">颜色</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <Button variant="primary" className="px-4 py-2" disabled={creating} onClick={handleCreate}>
            <Plus className="h-4 w-4" />
            创建
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">加载中…</div>
        ) : tags.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">暂无标签</div>
        ) : (
          <div className="space-y-3">
            {tags.map((tag) => (
              <div key={tag.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border-light bg-surface-primary p-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color || TAG_COLORS[0] }} />
                    <span className="text-lg font-medium text-text-primary">{tag.name}</span>
                    <span className="text-sm text-text-secondary">关联 {tag.usageCount || 0} 张表</span>
                  </div>
                  {tag.createdAt && (
                    <p className="mt-1 text-xs text-text-tertiary">
                      创建于 {new Date(tag.createdAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <ColorPicker
                    value={tag.color || TAG_COLORS[0]}
                    onChange={(next) => handleColorChange(tag, next)}
                  />
                  <Button variant="neutral" className="px-3 py-2 text-red-400" onClick={() => handleDelete(tag)}>
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
