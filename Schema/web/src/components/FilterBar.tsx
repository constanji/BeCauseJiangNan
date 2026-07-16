import React from 'react';
import { api } from '../api/client';
import { Tag } from '../lib/uiState';
import TagPicker from './TagPicker';

type SchemaOption = {
  schemaName: string;
  tableCount?: number | null;
  dataSourceId?: string;
  label?: string;
};

export default function FilterBar({
  dataSourceId,
  schemaName,
  tagIds,
  onDataSourceChange,
  onSchemaChange,
  onTagIdsChange,
  showTags = true,
  singleTag = false,
  catalogMode = false,
  requireSchema = false,
}: {
  dataSourceId: string;
  schemaName: string;
  tagIds: number[];
  onDataSourceChange: (value: string) => void;
  onSchemaChange: (value: string) => void;
  onTagIdsChange: (ids: number[]) => void;
  showTags?: boolean;
  singleTag?: boolean;
  catalogMode?: boolean;
  requireSchema?: boolean;
}) {
  const [dataSources, setDataSources] = React.useState<any[]>([]);
  const [schemas, setSchemas] = React.useState<SchemaOption[]>([]);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const schemasLoadSeq = React.useRef(0);

  React.useEffect(() => {
    if (catalogMode) {
      api.listDataSources().then((r) => {
        if (r.success) setDataSources(r.data || []);
      });
    } else {
      api.getCatalogStats().then((r) => {
        if (r.success && r.data) setDataSources(r.data.byDataSource || []);
      });
    }
    api.listTags().then((r) => {
      if (r.success) setTags(r.data || []);
    });
  }, [catalogMode]);

  React.useEffect(() => {
    if (catalogMode) {
      if (!dataSourceId) {
        setSchemas([]);
        return;
      }
      const seq = ++schemasLoadSeq.current;
      api.listSchemas(dataSourceId, 'auto').then((r) => {
        if (seq !== schemasLoadSeq.current) return;
        if (!r.success) return;
        setSchemas((r.data || []).map((item: SchemaOption) => ({
          schemaName: item.schemaName,
          tableCount: item.tableCount,
        })));
      });
      return;
    }

    const seq = ++schemasLoadSeq.current;
    const requestedDataSourceId = dataSourceId;

    api.getCatalogStats().then((r) => {
      if (seq !== schemasLoadSeq.current) return;
      if (!r.success || !r.data) return;

      const all = r.data.bySchema || [];
      const dsNames = new Map(
        (r.data.byDataSource || []).map((ds) => [String(ds.dataSourceId), ds.dataSourceName]),
      );

      if (!requestedDataSourceId) {
        setSchemas(
          all.map((item) => ({
            schemaName: item.schemaName,
            tableCount: item.count,
            dataSourceId: String(item.dataSourceId),
            label: `${dsNames.get(String(item.dataSourceId)) || item.dataSourceId} · ${item.schemaName} (${item.count})`,
          })).sort((a, b) => (a.label || a.schemaName).localeCompare(b.label || b.schemaName, 'zh-CN')),
        );
        return;
      }

      setSchemas(
        all
          .filter((item) => String(item.dataSourceId) === String(requestedDataSourceId))
          .map((item) => ({
            schemaName: item.schemaName,
            tableCount: item.count,
            dataSourceId: String(item.dataSourceId),
          }))
          .sort((a, b) => a.schemaName.localeCompare(b.schemaName, 'zh-CN')),
      );
    });
  }, [catalogMode, dataSourceId]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <label className="block text-sm">
        <span className="mb-1 block text-text-secondary">数据源</span>
        <select
          className="input"
          value={dataSourceId}
          onChange={(e) => {
            onDataSourceChange(e.target.value);
            onSchemaChange('');
          }}
        >
          <option value="">{catalogMode ? '请选择' : '全部'}</option>
          {dataSources.map((ds) => (
            <option
              key={catalogMode ? ds.id : ds.dataSourceId}
              value={catalogMode ? ds.id : ds.dataSourceId}
            >
              {catalogMode
                ? `${ds.name}${ds.database ? ` (${ds.database})` : ''}`
                : `${ds.dataSourceName} (${ds.count})`}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-text-secondary">Schema</span>
        <select className="input" value={schemaName} onChange={(e) => onSchemaChange(e.target.value)}>
          <option value="">{requireSchema ? '请选择' : '全部'}</option>
          {schemas.map((item) => (
            <option
              key={item.dataSourceId ? `${item.dataSourceId}:${item.schemaName}` : item.schemaName}
              value={item.schemaName}
            >
              {item.label ?? (item.tableCount != null ? `${item.schemaName} (${item.tableCount})` : item.schemaName)}
            </option>
          ))}
        </select>
      </label>
      {showTags && (
        <div className="md:col-span-3">
          <span className="mb-2 block text-sm text-text-secondary">标签</span>
          <TagPicker
            tags={tags}
            value={tagIds}
            onChange={onTagIdsChange}
            multiple={!singleTag}
          />
        </div>
      )}
    </div>
  );
}
