import React from 'react';
import { api } from '../api/client';
import LightSchemaEditor from '../components/LightSchemaEditor';
import StatusBanner from '../components/StatusBanner';
import { cn } from '../lib/cn';
import { parseLightSchemaContent } from '../lib/lightSchemaTypes';
import { pickNextTableName } from '../lib/reviewNav';

export default function SchemaViewer({
  dataSourceId,
  schemaName = '',
  initialTable,
  onSchemaChanged,
}: {
  dataSourceId: string;
  schemaName?: string;
  initialTable?: string | null;
  onSchemaChanged?: () => void;
}) {
  const [items, setItems] = React.useState<any[]>([]);
  const [current, setCurrent] = React.useState<any | null>(null);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loadSeq = React.useRef(0);

  const reload = React.useCallback(() => {
    if (!schemaName) {
      setItems([]);
      setCurrent(null);
      setLoading(false);
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    api.listLightSchemas(dataSourceId, schemaName)
      .then((r) => {
        if (seq !== loadSeq.current) return;
        if (!r.success) throw new Error(r.error || '加载 LightSchema 失败');
        const rows = r.data || [];
        setItems(rows);
        setCurrent((prev) => {
          if (!prev) {
            if (initialTable) {
              return rows.find((row: any) => (row.table_name || row.tableName) === initialTable) || rows[0] || null;
            }
            return rows[0] || null;
          }
          const name = prev.table_name || prev.tableName;
          return rows.find((row: any) => (row.table_name || row.tableName) === name) || rows[0] || null;
        });
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        setError(err.message || String(err));
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }, [dataSourceId, schemaName, initialTable]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  React.useEffect(() => {
    if (!initialTable || !schemaName) return;
    api.getLightSchema(dataSourceId, initialTable, schemaName).then((r) => {
      if (r.success && r.data) setCurrent(r.data);
    });
  }, [dataSourceId, schemaName, initialTable]);

  const filtered = items.filter((row) =>
    String(row.table_name || row.tableName).toLowerCase().includes(search.toLowerCase()),
  );

  const currentTableName = current?.table_name || current?.tableName;
  const parsed = parseLightSchemaContent(current?.content, currentTableName || '');
  const ddlText = current?.ddl_text || current?.ddlText || '';

  const handleSave = async (next: NonNullable<ReturnType<typeof parseLightSchemaContent>>) => {
    if (!currentTableName) throw new Error('未选择表');
    const res = await api.updateLightSchemaContent(dataSourceId, currentTableName, next, schemaName);
    if (!res.success || !res.data) throw new Error(res.error || '保存失败');
    const updated = res.data;
    setCurrent(updated);
    setItems((prev) => prev.map((row) => {
      const name = row.table_name || row.tableName;
      return name === currentTableName ? updated : row;
    }));
    onSchemaChanged?.();
  };

  const handleDelete = async () => {
    if (!currentTableName) throw new Error('未选择表');
    const orderedNames = filtered.map((row) => String(row.table_name || row.tableName));
    const nextTableName = pickNextTableName(orderedNames, currentTableName);

    const res = await api.deleteLightSchema(dataSourceId, currentTableName, schemaName);
    if (!res.success || res.deleted === false) {
      throw new Error(res.error || '删除未生效');
    }
    const remaining = items.filter((row) => (row.table_name || row.tableName) !== currentTableName);
    setItems(remaining);
    setCurrent(
      nextTableName
        ? remaining.find((row) => (row.table_name || row.tableName) === nextTableName) ?? null
        : null,
    );
    onSchemaChanged?.();
  };

  return (
    <div className="grid h-[48rem] grid-rows-[auto_1fr] gap-4 overflow-hidden rounded-lg border border-border-light bg-surface-primary p-4 lg:grid-cols-[280px_1fr] lg:grid-rows-1">
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 shrink-0 font-medium text-text-primary">LightSchema 预览</div>
        <input className="input mb-3 shrink-0" placeholder="搜索表名" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain text-sm">
          {filtered.map((row) => {
            const name = row.table_name || row.tableName;
            const active = currentTableName === name;
            return (
              <button
                key={name}
                type="button"
                className={cn(
                  'block w-full rounded-md px-3 py-2.5 text-left transition-colors',
                  active
                    ? 'list-item-active text-text-primary'
                    : 'border border-transparent text-text-primary hover:bg-surface-tertiary',
                )}
                onClick={() => setCurrent(row)}
              >
                <span className="truncate">{name}</span>
              </button>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="py-4 text-center text-xs text-text-tertiary">当前 Schema 暂无已生成表</div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="mb-3 shrink-0 font-medium text-text-primary">{currentTableName || '选择表'}</div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!schemaName ? (
            <div className="text-sm text-text-secondary">等待 Schema 加载…</div>
          ) : loading ? (
            <div className="text-sm text-text-secondary">加载中…</div>
          ) : error ? (
            <StatusBanner tone="error" title="预览失败" message={error} />
          ) : !current ? (
            <div className="text-sm text-text-secondary">请选择已生成的表进行预览</div>
          ) : !parsed ? (
            <div className="text-sm text-text-secondary">LightSchema 数据损坏或为空</div>
          ) : (
            <LightSchemaEditor
              key={currentTableName}
              content={parsed}
              ddlText={ddlText}
              showSamples
              showDdlTab
              onSave={handleSave}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
