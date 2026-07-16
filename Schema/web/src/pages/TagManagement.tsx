import React from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import Button from '../components/Button';
import StatusBanner from '../components/StatusBanner';
import { ColorPickerPopover } from '../components/TagPicker';
import TagBadge from '../components/TagBadge';
import { groupTagsByParent, getTagDisplayName } from '../lib/tagDisplay';
import { TAG_COLORS, Tag } from '../lib/uiState';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';

function TagRow({
  tag,
  nested = false,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  onDelete,
  onColorChange,
  onAddChild,
}: {
  tag: Tag;
  nested?: boolean;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onDelete: (tag: Tag) => void;
  onColorChange: (tag: Tag, color: string) => void;
  onAddChild?: (tag: Tag) => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border-light bg-surface-primary p-4',
        nested && 'ml-6 border-l-2 border-l-brand/35',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {!nested && hasChildren && onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-0.5 shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
            aria-expanded={expanded}
            aria-label={expanded ? '收起子标签' : '展开子标签'}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        {!nested && !hasChildren && <span className="w-6 shrink-0" aria-hidden />}
        <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          {nested ? (
            <TagBadge tag={tag} />
          ) : (
            <>
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: tag.color || TAG_COLORS[0] }}
              />
              <span className="text-lg font-medium text-text-primary">{tag.name}</span>
            </>
          )}
          <span className="text-sm text-text-secondary">关联 {tag.usageCount || 0} 张表</span>
          {!nested && hasChildren && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-sm text-text-tertiary transition-colors hover:text-text-secondary"
            >
              {tag.childCount || 0} 个子标签
            </button>
          )}
        </div>
        {tag.createdAt && (
          <p className="mt-1 text-xs text-text-tertiary">
            创建于 {new Date(tag.createdAt).toLocaleString()}
          </p>
        )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ColorPickerPopover
          value={tag.color || TAG_COLORS[0]}
          label="修改颜色"
          onChange={(next) => onColorChange(tag, next)}
        />
        {!nested && onAddChild && (
          <Button variant="neutral" className="px-3 py-2" onClick={() => onAddChild(tag)}>
            <Plus className="h-4 w-4" />
            添加子标签
          </Button>
        )}
        <Button variant="neutral" className="px-3 py-2 text-red-400" onClick={() => onDelete(tag)}>
          <Trash2 className="h-4 w-4" />
          删除
        </Button>
      </div>
    </div>
  );
}

function ChildTagForm({
  parent,
  name,
  color,
  creating,
  onNameChange,
  onColorChange,
  onCancel,
  onCreate,
}: {
  parent: Tag;
  name: string;
  color: string;
  creating: boolean;
  onNameChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="ml-6 rounded-lg border border-brand/35 border-l-2 border-l-brand/35 bg-brand-muted p-4">
      <h4 className="text-sm font-medium text-text-primary">添加子标签</h4>
      <p className="mt-1 text-xs text-text-tertiary">
        将显示为「{parent.name}：子标签名」
      </p>
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-text-secondary">子标签名称</span>
          <input
            className="input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="例如：机构、客户"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void onCreate(); }}
          />
        </label>
        <div className="flex items-end gap-2">
          <ColorPickerPopover
            value={color}
            label="选择颜色"
            closeOnSelect={false}
            onChange={onColorChange}
          />
          <div className="flex gap-2">
          <Button variant="neutral" onClick={onCancel}>取消</Button>
          <Button variant="primary" className="px-4 py-2" disabled={creating} onClick={onCreate}>
            <Plus className="h-4 w-4" />
            创建
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TagManagement() {
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(TAG_COLORS[0]);
  const [creating, setCreating] = React.useState(false);
  const [childParent, setChildParent] = React.useState<Tag | null>(null);
  const [childName, setChildName] = React.useState('');
  const [childColor, setChildColor] = React.useState(TAG_COLORS[0]);
  const [creatingChild, setCreatingChild] = React.useState(false);
  const [expandedParents, setExpandedParents] = React.useState<Record<number, boolean>>({});
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

  const { roots, childrenByParent } = React.useMemo(() => groupTagsByParent(tags), [tags]);

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

  const handleCreateChild = async () => {
    if (!childParent) return;
    const trimmed = childName.trim();
    if (!trimmed) {
      setError('请输入子标签名称');
      return;
    }
    setCreatingChild(true);
    setError(null);
    const res = await api.createTag({
      name: trimmed,
      color: childColor,
      parentId: childParent.id,
    });
    setCreatingChild(false);
    if (!res.success) {
      setError(res.error || '创建失败');
      showToast(res.error || '创建失败', 'error');
      return;
    }
    setChildName('');
    setExpandedParents((prev) => ({ ...prev, [childParent.id]: true }));
    reload();
    showToast(`子标签「${getTagDisplayName(res.data!)}」创建成功`);
  };

  const handleDelete = async (tag: Tag) => {
    const childCount = tag.childCount || 0;
    const msg = childCount > 0
      ? `删除标签「${getTagDisplayName(tag)}」将同时删除 ${childCount} 个子标签${
        tag.usageCount ? `，并解除 ${tag.usageCount} 张表的关联` : ''
      }，确定继续？`
      : tag.usageCount
        ? `删除标签「${getTagDisplayName(tag)}」将解除 ${tag.usageCount} 张表的关联，确定继续？`
        : `确定删除标签「${getTagDisplayName(tag)}」？`;
    if (!window.confirm(msg)) return;
    const res = await api.deleteTag(tag.id);
    if (!res.success) {
      setError(res.error || '删除失败');
      showToast(res.error || '删除失败', 'error');
      return;
    }
    if (childParent?.id === tag.id) setChildParent(null);
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

  const toggleParentExpanded = (parentId: number) => {
    setExpandedParents((prev) => ({ ...prev, [parentId]: !prev[parentId] }));
  };

  const openChildForm = (parent: Tag) => {
    setExpandedParents((prev) => ({ ...prev, [parent.id]: true }));
    if (childParent?.id === parent.id) {
      setChildParent(null);
      setChildName('');
      return;
    }
    setChildParent(parent);
    setChildName('');
    setChildColor(parent.color || TAG_COLORS[0]);
    setError(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-4">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-text-primary">标签管理</h2>
        <p className="mt-1 text-sm text-text-secondary">
          创建全局表级标签；在一级标签下可添加子标签，筛选与打标时显示为「父标签：子标签」
        </p>
      </div>

      {error && <div className="mb-4"><StatusBanner tone="error" title="操作失败" message={error} /></div>}

      <div className="mb-6 rounded-lg border border-border-light bg-surface-primary p-4">
        <h3 className="mb-3 text-sm font-medium text-text-primary">新建一级标签</h3>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-text-secondary">名称</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：指标、银行卡"
            />
          </label>
          <div className="flex items-end gap-2">
            <ColorPickerPopover
              value={color}
              label="选择颜色"
              closeOnSelect={false}
              onChange={setColor}
            />
            <Button variant="primary" className="px-4 py-2" disabled={creating} onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              创建
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">加载中…</div>
        ) : roots.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">暂无标签</div>
        ) : (
          <div className="space-y-3">
            {roots.map((tag) => {
              const children = childrenByParent.get(tag.id) || [];
              const hasChildren = children.length > 0;
              const expanded = !!expandedParents[tag.id];
              return (
                <div key={tag.id} className="space-y-2">
                  <TagRow
                    tag={tag}
                    hasChildren={hasChildren}
                    expanded={expanded}
                    onToggleExpand={hasChildren ? () => toggleParentExpanded(tag.id) : undefined}
                    onDelete={handleDelete}
                    onColorChange={handleColorChange}
                    onAddChild={openChildForm}
                  />
                  {childParent?.id === tag.id && (
                    <ChildTagForm
                      parent={tag}
                      name={childName}
                      color={childColor}
                      creating={creatingChild}
                      onNameChange={setChildName}
                      onColorChange={setChildColor}
                      onCancel={() => {
                        setChildParent(null);
                        setChildName('');
                      }}
                      onCreate={handleCreateChild}
                    />
                  )}
                  {expanded && children.map((child) => (
                    <TagRow
                      key={child.id}
                      tag={child}
                      nested
                      onDelete={handleDelete}
                      onColorChange={handleColorChange}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
