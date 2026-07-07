import React from 'react';
import { api } from '../api/client';
import { Tag } from '../lib/uiState';
import TagPicker from './TagPicker';

type SchemaOption = { schemaName: string; tableCount?: number | null };

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
      api.listSchemas(dataSourceId, 'auto').then((r) => {
        if (!r.success) return;
        setSchemas((r.data || []).map((item: SchemaOption) => ({
          schemaName: item.schemaName,
          tableCount: item.tableCount,
        })));
      });
      return;
    }
    api.getCatalogStats().then((r) => {
      if (!r.success || !r.data) return;
      const all = r.data.bySchema || [];
      if (!dataSourceId) {
        setSchemas(all.map((item: any) => ({ schemaName: item.schemaName })));
        return;
      }
      api.listCatalog({ dataSourceId }).then((listRes) => {
        if (!listRes.success) return;
        const names = [...new Set((listRes.data || []).map((item: any) => item.schemaName))];
        setSchemas(names.sort().map((name) => ({ schemaName: name })));
      });
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
            <option key={item.schemaName} value={item.schemaName}>
              {item.tableCount != null ? `${item.schemaName} (${item.tableCount})` : item.schemaName}
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
