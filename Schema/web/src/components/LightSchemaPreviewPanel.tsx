import React from 'react';
import { X } from 'lucide-react';
import { api } from '../api/client';
import { CatalogDetail } from '../lib/uiState';
import { parseLightSchemaContent } from '../lib/lightSchemaTypes';
import Button from './Button';
import LightSchemaEditor from './LightSchemaEditor';
import TagBadge from './TagBadge';

export default function LightSchemaPreviewPanel({
  item,
  onClose,
  onUpdated,
  onDeleted,
}: {
  item: CatalogDetail | null;
  onClose: () => void;
  onUpdated?: (item: CatalogDetail) => void;
  onDeleted?: (id: number) => void;
}) {
  const [detail, setDetail] = React.useState(item);

  React.useEffect(() => {
    setDetail(item);
  }, [item]);

  if (!detail) return null;

  const content = parseLightSchemaContent(detail.content, detail.tableName);

  const handleSave = async (next: NonNullable<ReturnType<typeof parseLightSchemaContent>>) => {
    const res = await api.updateCatalogContent(detail.id, next);
    if (!res.success || !res.data) throw new Error(res.error || '保存失败');
    setDetail(res.data);
    onUpdated?.(res.data);
  };

  const handleDelete = async () => {
    const res = await api.deleteCatalogItem(detail.id);
    if (!res.success) throw new Error(res.error || '删除失败');
    onDeleted?.(detail.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border-light bg-surface-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-light px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">
              {detail.dataSourceName} / {detail.schemaName}.{detail.tableName}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />)}
            </div>
          </div>
          <Button variant="neutral" className="px-2 py-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
          {!content ? (
            <p className="text-sm text-text-secondary">LightSchema 数据损坏或为空</p>
          ) : (
            <LightSchemaEditor
              content={content}
              ddlText={detail.ddlText}
              showSamples
              onSave={handleSave}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
