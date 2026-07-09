import type { CatalogDetail, CatalogItem, RemoteTablePreview, SearchHit, Tag } from '../lib/uiState';
import type { LightSchemaContent } from '../lib/lightSchemaTypes';

export type ApiResponse<T> = { success: boolean; data?: T; error?: string; message?: string };

export type CatalogMeta = { source?: string; cachedAt?: string | null };

export type SchemasResponse = ApiResponse<Array<{ schemaName: string; tableCount?: number | null }>> & {
  meta?: CatalogMeta;
};

export type TablesResponse = ApiResponse<string[]> & { meta?: CatalogMeta };

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

const json = async <T,>(input: RequestInfo | URL, init?: RequestInit): Promise<ApiResponse<T>> => {
  const res = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      const payload = text ? JSON.parse(text) : {};
      return { success: false, error: payload.error || payload.message || `HTTP ${res.status}` };
    } catch {
      return { success: false, error: text || `HTTP ${res.status}` };
    }
  }
  try {
    return text ? JSON.parse(text) : ({ success: true } as ApiResponse<T>);
  } catch {
    return { success: false, error: '响应解析失败' };
  }
};

const blob = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });

export const api = {
  listDataSources: () => json('/api/data-sources'),
  getDataSource: (id: string) => json(`/api/data-sources/${id}`),
  createDataSource: (body: unknown) => json('/api/data-sources', { method: 'POST', body: JSON.stringify(body) }),
  updateDataSource: (id: string, body: unknown) => json(`/api/data-sources/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDataSource: (id: string) => json(`/api/data-sources/${id}`, { method: 'DELETE' }),
  testDataSource: (id: string) => json(`/api/data-sources/${id}/test`, { method: 'POST' }),
  testDataSourceConfig: (body: unknown) => json('/api/data-sources/test', { method: 'POST', body: JSON.stringify(body) }),
  listSchemas: (id: string, source: 'auto' | 'remote' | 'sqlite' = 'auto') =>
    json<Array<{ schemaName: string; tableCount?: number | null }>>(`/api/data-sources/${id}/schemas${qs({ source })}`),
  listTables: (id: string, schemaName: string, source: 'auto' | 'remote' | 'sqlite' = 'auto') =>
    json<string[]>(`/api/data-sources/${id}/schemas/${encodeURIComponent(schemaName)}/tables${qs({ source })}`),
  refreshCatalog: (id: string, schemaName: string) =>
    json<{
      schemas: Array<{ schemaName: string; tableCount?: number | null }>;
      tables: string[];
      schemaName: string | null;
    }>(`/api/data-sources/${id}/catalog/refresh`, {
      method: 'POST',
      body: JSON.stringify({ schemaName }),
    }),
  refreshSchemaTables: (id: string, schemaName: string) =>
    json<string[]>(`/api/data-sources/${id}/catalog/refresh-schema/${encodeURIComponent(schemaName)}`, {
      method: 'POST',
    }),
  generateLightSchema: (id: string, body: unknown, signal?: AbortSignal) => json(`/api/data-sources/${id}/light-schema/generate`, { method: 'POST', body: JSON.stringify(body), signal }),
  listLightSchemas: (id: string, schemaName?: string) => json(`/api/data-sources/${id}/light-schema${qs({ schemaName })}`),
  getLightSchema: (id: string, tableName: string, schemaName?: string) =>
    json(`/api/data-sources/${id}/light-schema/${encodeURIComponent(tableName)}${qs({ schemaName })}`),
  updateLightSchemaContent: (id: string, tableName: string, content: LightSchemaContent, schemaName?: string) =>
    json(`/api/data-sources/${id}/light-schema/${encodeURIComponent(tableName)}${qs({ schemaName })}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  deleteLightSchema: (id: string, tableName: string, schemaName?: string) =>
    json<{ deleted?: boolean }>(`/api/data-sources/${id}/light-schema/${encodeURIComponent(tableName)}${qs({ schemaName })}`, { method: 'DELETE' }),
  exportExcel: (id: string, body: unknown, signal?: AbortSignal) => blob(`/api/data-sources/${id}/export/excel`, { method: 'POST', body: JSON.stringify(body), signal }),

  listTags: () => json<Tag[]>('/api/tags'),
  createTag: (body: { name: string; color?: string }) => json<Tag>('/api/tags', { method: 'POST', body: JSON.stringify(body) }),
  updateTag: (id: number, body: { name?: string; color?: string }) => json<Tag>(`/api/tags/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTag: (id: number) => json(`/api/tags/${id}`, { method: 'DELETE' }),

  listCatalog: (params: {
    dataSourceId?: string;
    schemaName?: string;
    tagIds?: number[];
    q?: string;
  } = {}) => json<CatalogItem[]>(`/api/light-schemas${qs({
    dataSourceId: params.dataSourceId,
    schemaName: params.schemaName,
    q: params.q,
    tagIds: params.tagIds?.length ? params.tagIds.join(',') : undefined,
  })}`),

  getCatalogItem: (id: number) => json<CatalogDetail>(`/api/light-schemas/${id}`),
  updateCatalogContent: (id: number, content: LightSchemaContent) =>
    json<CatalogDetail>(`/api/light-schemas/${id}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  deleteCatalogItem: (id: number) => json(`/api/light-schemas/${id}`, { method: 'DELETE' }),
  setCatalogTags: (id: number, tagIds: number[]) =>
    json(`/api/light-schemas/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) }),

  previewCatalogRows: (
    id: number,
    body?: {
      filters?: Array<{ column: string; value: string }>;
      limit?: number;
      dedupeBy?: string;
    },
  ) => json<{
    columns: string[];
    rows: Record<string, unknown>[];
    truncated: boolean;
    limit: number;
    filtered?: boolean;
    deduped?: boolean;
    dedupeBy?: string;
  }>(`/api/light-schemas/${id}/preview-rows`, { method: 'POST', body: JSON.stringify(body || {}) }),

  previewCatalogDistinct: (
    id: number,
    body: { column: string; limit?: number },
  ) => json<{
    column: string;
    values: string[];
    truncated: boolean;
    limit: number;
  }>(`/api/light-schemas/${id}/preview-distinct`, { method: 'POST', body: JSON.stringify(body) }),

  getCatalogStats: () => json<{
    byDataSource: Array<{ dataSourceId: string; dataSourceName: string; count: number }>;
    bySchema: Array<{ schemaName: string; count: number }>;
    byTag: Array<{ tagId: number; tagName: string; color?: string; count: number }>;
    total: number;
  }>('/api/light-schemas/stats'),

  searchLightSchemas: (params: {
    q: string;
    dataSourceId?: string;
    schemaName?: string;
    tagId?: string;
  }) => json<SearchHit[]>(`/api/light-schemas/search${qs(params)}`),

  searchLightSchemaData: (params: {
    q: string;
    dataSourceId: string;
    schemaName: string;
  }) => json<SearchHit[]>(`/api/light-schemas/data-search${qs({
    q: params.q,
    dataSourceId: params.dataSourceId,
    schemaName: params.schemaName,
    searchLight: '1',
  })}`),

  deepSearchLightSchemaData: (body: {
    q: string;
    dataSourceId: string;
    schemaName: string;
    tableNames?: string[];
  }) => json<SearchHit[]>('/api/light-schemas/deep-data-search', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  searchSchemaExplore: (dataSourceId: string, params: { q: string; schemaName: string }) =>
    json<SearchHit[]>(`/api/data-sources/${dataSourceId}/catalog/explore-search${qs(params)}`),

  previewRemoteTable: (dataSourceId: string, schemaName: string, tableName: string) =>
    json<RemoteTablePreview>(
      `/api/data-sources/${dataSourceId}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}/preview`,
    ),

  previewRemoteRows: (
    dataSourceId: string,
    schemaName: string,
    tableName: string,
    body?: {
      columns: string[];
      filters?: Array<{ column: string; value: string }>;
      limit?: number;
      dedupeBy?: string;
    },
  ) => json<{
    columns: string[];
    rows: Record<string, unknown>[];
    truncated: boolean;
    limit: number;
    filtered?: boolean;
    deduped?: boolean;
    dedupeBy?: string;
  }>(
    `/api/data-sources/${dataSourceId}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}/preview-rows`,
    { method: 'POST', body: JSON.stringify(body || {}) },
  ),

  previewRemoteDistinct: (
    dataSourceId: string,
    schemaName: string,
    tableName: string,
    body: { column: string; limit?: number },
  ) => json<{
    column: string;
    values: string[];
    truncated: boolean;
    limit: number;
  }>(
    `/api/data-sources/${dataSourceId}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}/preview-distinct`,
    { method: 'POST', body: JSON.stringify(body) },
  ),

  exportCatalogExcel: (
    body: {
      items?: Array<{ lightSchemaId?: number; dataSourceId?: string; schemaName?: string; tableName?: string }>;
      tagIds?: number[];
      mode?: 'light_schema' | 'table_data';
    },
    signal?: AbortSignal,
  ) => blob('/api/light-schemas/export/excel', { method: 'POST', body: JSON.stringify(body), signal }),
};
