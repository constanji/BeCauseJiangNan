import React from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import Button from './Button';
import StatusBanner from './StatusBanner';
import { useToast } from '../context/ToastProvider';
import { highlightText } from '../lib/highlightText';
import {
  LightSchemaColumn,
  LightSchemaContent,
  cloneLightSchemaContent,
  emptyLightSchemaColumn,
} from '../lib/lightSchemaTypes';

const COLUMN_PAGE_SIZE = 30;

function updateDraftColumn(
  draft: LightSchemaContent,
  index: number,
  patch: Partial<LightSchemaColumn>,
): LightSchemaContent {
  const columns = draft.columns.map((col, i) => (i === index ? { ...col, ...patch } : col));
  return { ...draft, columns };
}

export default function LightSchemaEditor({
  content,
  ddlText = '',
  showSamples = false,
  showDdlTab = false,
  highlightQuery = '',
  onSave,
  onDelete,
}: {
  content: LightSchemaContent;
  ddlText?: string;
  showSamples?: boolean;
  showDdlTab?: boolean;
  highlightQuery?: string;
  onSave: (content: LightSchemaContent) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<LightSchemaContent>(() => cloneLightSchemaContent(content));
  const [tab, setTab] = React.useState<'columns' | 'ddl'>('columns');
  const [columnPage, setColumnPage] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [displayDdl, setDisplayDdl] = React.useState(ddlText);
  const [newColumnIndices, setNewColumnIndices] = React.useState<Set<number>>(() => new Set());
  const { showToast } = useToast();

  React.useEffect(() => {
    if (!editing) {
      setDraft(cloneLightSchemaContent(content));
      setDisplayDdl(ddlText);
    }
  }, [content, ddlText, editing]);

  React.useEffect(() => {
    setColumnPage(1);
  }, [content.tableName, editing, tab, highlightQuery]);

  const activeContent = editing ? draft : content;
  const highlightQ = highlightQuery.trim();
  const normalizedHighlightQ = highlightQ.toLowerCase();

  const displayColumns = React.useMemo(() => {
    const indexed = activeContent.columns.map((col, sourceIndex) => ({ col, sourceIndex }));
    if (editing || !normalizedHighlightQ) return indexed;

    const matched: typeof indexed = [];
    const unmatched: typeof indexed = [];
    for (const item of indexed) {
      const searchable = `${item.col.name} ${item.col.description || ''}`.toLowerCase();
      if (searchable.includes(normalizedHighlightQ)) matched.push(item);
      else unmatched.push(item);
    }
    return [...matched, ...unmatched];
  }, [activeContent.columns, editing, normalizedHighlightQ]);

  const totalColumnPages = Math.max(1, Math.ceil(displayColumns.length / COLUMN_PAGE_SIZE));
  const pageColumns = displayColumns.slice(
    (columnPage - 1) * COLUMN_PAGE_SIZE,
    columnPage * COLUMN_PAGE_SIZE,
  );

  const renderReadonlyText = (text: string, muted = false) => {
    if (!text) return <span className="text-text-secondary">—</span>;
    const className = muted ? 'text-text-secondary' : 'font-medium text-text-primary';
    if (highlightQ) {
      return <span className={className}>{highlightText(text, highlightQ)}</span>;
    }
    return <span className={className}>{text}</span>;
  };

  const startEdit = () => {
    setDraft(cloneLightSchemaContent(content));
    setNewColumnIndices(new Set());
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(cloneLightSchemaContent(content));
    setNewColumnIndices(new Set());
    setError(null);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, tableName: content.tableName });
      setEditing(false);
      showToast('保存成功');
    } catch (err: any) {
      setError(err?.message || String(err));
      showToast(err?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchema = async () => {
    if (!onDelete) return;
    if (!window.confirm(`确定删除 LightSchema「${content.tableName}」？此操作不可恢复。`)) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete();
      setEditing(false);
      showToast('删除成功');
    } catch (err: any) {
      setError(err?.message || String(err));
      showToast(err?.message || '删除失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeColumn = (index: number) => {
    if (draft.columns.length <= 1) {
      setError('至少保留一列');
      return;
    }
    setError(null);
    setDraft({ ...draft, columns: draft.columns.filter((_, i) => i !== index) });
    setNewColumnIndices((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  };

  const addColumn = () => {
    setError(null);
    const nextColumns = [...draft.columns, emptyLightSchemaColumn()];
    const newIndex = nextColumns.length - 1;
    setDraft({ ...draft, columns: nextColumns });
    setNewColumnIndices((prev) => new Set([...prev, newIndex]));
    setColumnPage(Math.max(1, Math.ceil(nextColumns.length / COLUMN_PAGE_SIZE)));
  };

  const isNewColumn = (index: number) => newColumnIndices.has(index);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {showDdlTab && (
            <>
              <Button variant={tab === 'columns' ? 'primary' : 'neutral'} className="px-2 py-1 text-xs" onClick={() => setTab('columns')}>
                列详情
              </Button>
              <Button variant={tab === 'ddl' ? 'primary' : 'neutral'} className="px-2 py-1 text-xs" onClick={() => setTab('ddl')}>
                DDL
              </Button>
            </>
          )}
          {editing && (!showDdlTab || tab === 'columns') && (
            <Button variant="neutral" className="px-2 py-1 text-xs" onClick={addColumn} disabled={saving}>
              <Plus className="h-3.5 w-3.5" />
              新增
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <>
              <Button variant="neutral" className="px-2 py-1 text-xs" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
              {onDelete && (
                <Button variant="neutral" className="px-2 py-1 text-xs text-red-400" onClick={handleDeleteSchema} disabled={saving}>
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="neutral" className="px-2 py-1 text-xs" onClick={cancelEdit} disabled={saving}>
                <X className="h-3.5 w-3.5" />
                取消
              </Button>
              <Button variant="primary" className="px-2 py-1 text-xs" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? '保存中…' : '保存'}
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <p className="mb-3 shrink-0 text-xs text-text-tertiary">
          已有列的列名、类型、可空不可修改；通过「新增」添加的列可编辑全部字段，备注与采样值均可编辑
        </p>
      )}

      {error && (
        <div className="mb-3 shrink-0">
          <StatusBanner tone="error" title="操作失败" message={error} />
        </div>
      )}

      {(!showDdlTab || tab === 'columns') ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <table className="w-full table-fixed text-sm">
              <thead className="sticky top-0 z-10 bg-surface-primary">
                <tr className="text-left text-text-secondary">
                  <th className="w-[9rem] whitespace-nowrap py-2 pr-3">列名</th>
                  <th className="w-[5.5rem] whitespace-nowrap py-2 pr-3">类型</th>
                  <th className="w-[4.5rem] whitespace-nowrap py-2 pr-3">可空</th>
                  <th className="whitespace-nowrap py-2 pr-3">备注</th>
                  {showSamples && <th className="w-[10rem] whitespace-nowrap py-2">采样值</th>}
                  {editing && <th className="w-16 whitespace-nowrap py-2 text-right">操作</th>}
                </tr>
              </thead>
              <tbody>
                {pageColumns.map(({ col, sourceIndex }) => {
                  const index = sourceIndex;
                  const canEditStructure = isNewColumn(index);
                  return (
                    <tr key={`${col.name}-${index}`} className="border-t border-border-light">
                      <td className="py-2 pr-3">
                        {editing && canEditStructure ? (
                          <input
                            className="input w-full py-1 text-xs"
                            value={col.name}
                            placeholder="列名"
                            onChange={(e) => setDraft(updateDraftColumn(draft, index, { name: e.target.value }))}
                          />
                        ) : (
                          renderReadonlyText(col.name)
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {editing && canEditStructure ? (
                          <input
                            className="input w-full py-1 text-xs"
                            value={col.type}
                            placeholder="类型"
                            onChange={(e) => setDraft(updateDraftColumn(draft, index, { type: e.target.value }))}
                          />
                        ) : (
                          <span className="text-text-primary">{col.type}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {editing && canEditStructure ? (
                          <select
                            className="input w-full py-1 text-xs"
                            value={col.nullable ? 'YES' : 'NO'}
                            aria-label={`列 ${col.name || index + 1} 可空`}
                            onChange={(e) => setDraft(updateDraftColumn(draft, index, { nullable: e.target.value === 'YES' }))}
                          >
                            <option value="YES">YES</option>
                            <option value="NO">NO</option>
                          </select>
                        ) : (
                          <span className="whitespace-nowrap text-text-primary">{col.nullable ? 'YES' : 'NO'}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {editing ? (
                          <input
                            className="input w-full py-1 text-xs"
                            value={col.description || ''}
                            placeholder="备注"
                            onChange={(e) => setDraft(updateDraftColumn(draft, index, { description: e.target.value }))}
                          />
                        ) : (
                          renderReadonlyText(col.description || '', true)
                        )}
                      </td>
                      {showSamples && (
                        <td className="py-2">
                          {editing ? (
                            <input
                              className="input w-full py-1 text-xs"
                              value={(col.sampleValues || []).join(', ')}
                              onChange={(e) => setDraft(updateDraftColumn(draft, index, {
                                sampleValues: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                              }))}
                              placeholder="逗号分隔"
                            />
                          ) : (
                            renderReadonlyText((col.sampleValues || []).join(', '), true)
                          )}
                        </td>
                      )}
                      {editing && (
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            className="rounded p-1 text-text-secondary hover:bg-surface-tertiary hover:text-red-400"
                            title="删除列"
                            aria-label={`删除列 ${col.name || index + 1}`}
                            onClick={() => removeColumn(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {activeContent.columns.length > 0 && (
            <div className="flex min-h-[3.75rem] shrink-0 items-center justify-between border-t border-border-light px-1 py-4 text-xs text-text-secondary">
              <span>共 {activeContent.columns.length} 列，每页 {COLUMN_PAGE_SIZE} 列</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="neutral"
                  className="px-2 py-1 text-xs"
                  disabled={columnPage <= 1}
                  onClick={() => setColumnPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <span className="min-w-[4rem] text-center text-text-primary">
                  {columnPage} / {totalColumnPages}
                </span>
                <Button
                  variant="neutral"
                  className="px-2 py-1 text-xs"
                  disabled={columnPage >= totalColumnPages}
                  onClick={() => setColumnPage((p) => Math.min(totalColumnPages, p + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto rounded bg-surface-secondary p-3 text-xs text-text-primary">
          {displayDdl || '—'}
        </pre>
      )}
    </div>
  );
}
