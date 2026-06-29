import React from 'react';
import { Pencil, Save, Trash2, X } from 'lucide-react';
import Button from './Button';
import StatusBanner from './StatusBanner';
import { useToast } from '../context/ToastProvider';
import {
  LightSchemaColumn,
  LightSchemaContent,
  cloneLightSchemaContent,
} from '../lib/lightSchemaTypes';

const COLUMN_PAGE_SIZE = 30;

function updateDraftColumn(
  draft: LightSchemaContent,
  index: number,
  patch: Partial<Pick<LightSchemaColumn, 'description' | 'sampleValues'>>,
): LightSchemaContent {
  const columns = draft.columns.map((col, i) => (i === index ? { ...col, ...patch } : col));
  return { ...draft, columns };
}

function mergeEditableFields(original: LightSchemaContent, draft: LightSchemaContent): LightSchemaContent {
  return {
    ...original,
    columns: original.columns.map((col, index) => ({
      ...col,
      description: draft.columns[index]?.description ?? col.description ?? '',
      sampleValues: draft.columns[index]?.sampleValues ?? col.sampleValues ?? [],
    })),
  };
}

export default function LightSchemaEditor({
  content,
  ddlText = '',
  showSamples = false,
  showDdlTab = false,
  onSave,
  onDelete,
}: {
  content: LightSchemaContent;
  ddlText?: string;
  showSamples?: boolean;
  showDdlTab?: boolean;
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
  const { showToast } = useToast();

  React.useEffect(() => {
    if (!editing) {
      setDraft(cloneLightSchemaContent(content));
      setDisplayDdl(ddlText);
    }
  }, [content, ddlText, editing]);

  React.useEffect(() => {
    setColumnPage(1);
  }, [content.tableName, editing, tab]);

  const activeContent = editing ? draft : content;
  const totalColumnPages = Math.max(1, Math.ceil(activeContent.columns.length / COLUMN_PAGE_SIZE));
  const pageColumns = activeContent.columns.slice(
    (columnPage - 1) * COLUMN_PAGE_SIZE,
    columnPage * COLUMN_PAGE_SIZE,
  );
  const pageOffset = (columnPage - 1) * COLUMN_PAGE_SIZE;

  const startEdit = () => {
    setDraft(cloneLightSchemaContent(content));
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(cloneLightSchemaContent(content));
    setError(null);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(mergeEditableFields(content, draft));
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
      showToast('删除成功');
    } catch (err: any) {
      setError(err?.message || String(err));
      showToast(err?.message || '删除失败', 'error');
      setSaving(false);
    }
  };

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
        <p className="mb-3 shrink-0 text-xs text-text-tertiary">列名、类型、可空来自数据库结构，仅可编辑备注与采样值</p>
      )}

      {error && (
        <div className="mb-3 shrink-0">
          <StatusBanner tone="error" title="操作失败" message={error} />
        </div>
      )}

      {(!showDdlTab || tab === 'columns') ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-primary">
                <tr className="text-left text-text-secondary">
                  <th className="py-2 pr-3">列名</th>
                  <th className="pr-3">类型</th>
                  <th className="pr-3">可空</th>
                  <th className="pr-3">备注</th>
                  {showSamples && <th>采样值</th>}
                </tr>
              </thead>
              <tbody>
                {pageColumns.map((col, pageIndex) => {
                  const index = pageOffset + pageIndex;
                  return (
                    <tr key={`${col.name}-${index}`} className="border-t border-border-light">
                      <td className="py-2 pr-3 font-medium text-text-primary">{col.name}</td>
                      <td className="py-2 pr-3 text-text-primary">{col.type}</td>
                      <td className="py-2 pr-3 text-text-primary">{col.nullable ? 'YES' : 'NO'}</td>
                      <td className="py-2 pr-3">
                        {editing ? (
                          <input
                            className="input py-1 text-xs"
                            value={col.description || ''}
                            onChange={(e) => setDraft(updateDraftColumn(draft, index, { description: e.target.value }))}
                          />
                        ) : (
                          <span className="text-text-secondary">{col.description || '—'}</span>
                        )}
                      </td>
                      {showSamples && (
                        <td className="py-2">
                          {editing ? (
                            <input
                              className="input py-1 text-xs"
                              value={(col.sampleValues || []).join(', ')}
                              onChange={(e) => setDraft(updateDraftColumn(draft, index, {
                                sampleValues: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                              }))}
                              placeholder="逗号分隔"
                            />
                          ) : (
                            <span className="text-text-secondary">
                              {(col.sampleValues || []).join(', ') || '—'}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {activeContent.columns.length > 0 && (
            <div className="mt-3 flex shrink-0 items-center justify-between border-t border-border-light pt-3 text-xs text-text-secondary">
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
        </>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto rounded bg-surface-secondary p-3 text-xs text-text-primary">
          {displayDdl || '—'}
        </pre>
      )}
    </div>
  );
}
