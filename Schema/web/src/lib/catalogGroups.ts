import { CatalogItem } from './uiState';

export type SchemaGroup = {
  key: string;
  schemaName: string;
  dataSourceId: string;
  dataSourceName: string;
  items: CatalogItem[];
};

export type DataSourceGroup = {
  key: string;
  dataSourceId: string;
  dataSourceName: string;
  schemas: SchemaGroup[];
  items: CatalogItem[];
};

export function buildSchemaGroups(items: CatalogItem[]): SchemaGroup[] {
  const map = new Map<string, SchemaGroup>();
  for (const item of items) {
    const key = `${item.dataSourceId}|${item.schemaName}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        schemaName: item.schemaName,
        dataSourceId: item.dataSourceId,
        dataSourceName: item.dataSourceName,
        items: [],
      });
    }
    map.get(key)!.items.push(item);
  }
  return [...map.values()].sort((a, b) => {
    const ds = a.dataSourceName.localeCompare(b.dataSourceName);
    return ds !== 0 ? ds : a.schemaName.localeCompare(b.schemaName);
  });
}

export function buildDataSourceGroups(items: CatalogItem[]): DataSourceGroup[] {
  const map = new Map<string, DataSourceGroup>();
  for (const item of items) {
    if (!map.has(item.dataSourceId)) {
      map.set(item.dataSourceId, {
        key: item.dataSourceId,
        dataSourceId: item.dataSourceId,
        dataSourceName: item.dataSourceName,
        schemas: [],
        items: [],
      });
    }
    map.get(item.dataSourceId)!.items.push(item);
  }
  for (const group of map.values()) {
    group.schemas = buildSchemaGroups(group.items);
  }
  return [...map.values()].sort((a, b) => a.dataSourceName.localeCompare(b.dataSourceName));
}
