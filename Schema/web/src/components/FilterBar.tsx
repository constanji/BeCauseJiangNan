import React from 'react';
import { api } from '../api/client';
import { Tag } from '../lib/uiState';
import TagPicker from './TagPicker';

export default function FilterBar({
  dataSourceId,
  schemaName,
  tagIds,
  onDataSourceChange,
  onSchemaChange,
  onTagIdsChange,
  showTags = true,
  singleTag = false,
}: {
  dataSourceId: string;
  schemaName: string;
  tagIds: number[];
  onDataSourceChange: (value: string) => void;
  onSchemaChange: (value: string) => void;
  onTagIdsChange: (ids: number[]) => void;
  showTags?: boolean;
  singleTag?: boolean;
}) {
  const [dataSources, setDataSources] = React.useState<any[]>([]);
  const [schemas, setSchemas] = React.useState<string[]>([]);
  const [tags, setTags] = React.useState<Tag[]>([]);

  React.useEffect(() => {
    api.getCatalogStats().then((r) => {
      if (r.success && r.data) setDataSources(r.data.byDataSource || []);
    });
    api.listTags().then((r) => {
      if (r.success) setTags(r.data || []);
    });
  }, []);

  React.useEffect(() => {
    api.getCatalogStats().then((r) => {
      if (!r.success || !r.data) return;
      const all = r.data.bySchema || [];
      if (!dataSourceId) {
        setSchemas(all.map((item: any) => item.schemaName));
        return;
      }
      api.listCatalog({ dataSourceId }).then((listRes) => {
        if (!listRes.success) return;
        const names = [...new Set((listRes.data || []).map((item: any) => item.schemaName))];
        setSchemas(names.sort());
      });
    });
  }, [dataSourceId]);

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
          <option value="">全部</option>
          {dataSources.map((ds) => (
            <option key={ds.dataSourceId} value={ds.dataSourceId}>
              {ds.dataSourceName} ({ds.count})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-text-secondary">Schema</span>
        <select className="input" value={schemaName} onChange={(e) => onSchemaChange(e.target.value)}>
          <option value="">全部</option>
          {schemas.map((name) => (
            <option key={name} value={name}>{name}</option>
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
