import type { CatalogDetail, CatalogItem, SearchHit, Tag } from '../lib/uiState';
import type { LightSchemaContent } from '../lib/lightSchemaTypes';

export type ApiResponse<T> = { success: boolean; data?: T; error?: string; message?: string };

export type CatalogMeta = { source?: string; cachedAt?: string | null };

export type SchemasResponse = ApiResponse<Array<{ schemaName: string; tableCount?: number | null }>> & {
  meta?: CatalogMeta;
};

export type TablesResponse = ApiResponse<string[]> & { meta?: CatalogMeta };

export type DataSearchResponse = ApiResponse<SearchHit[]> & {
  meta?: {
    totalTables?: number;
    totalColumns?: number;
    searchLight?: boolean;
    schemaTableNames?: string[];
  };
};

export type DeepSearchEvent =
  | { type: 'start'; totalTables: number }
  | { type: 'progress'; scanned: number; total: number; tableName: string }
  | { type: 'hit'; data: SearchHit }
  | { type: 'table_error'; tableName: string; error: string }
  | { type: 'done'; elapsedMs: number; hitCount: number; scannedTables: number; errorCount: number }
  | { type: 'error'; error: string };

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

async function consumeNdjsonStream(
  response: Response,
  onEvent: (event: DeepSearchEvent) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  if (!response.ok) {
    const text = await response.text();
    try {
      const payload = text ? JSON.parse(text) : {};
      return { ok: false, error: payload.error || payload.message || `HTTP ${response.status}` };
    } catch {
      return { ok: false, error: text || `HTTP ${response.status}` };
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return { ok: false, error: '响应无内容' };

  const decoder = new TextDecoder();
  let buffer = '';
  let streamError: string | undefined;

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed) as DeepSearchEvent;
      onEvent(event);
      if (event.type === 'error') streamError = event.error;
    } catch {
      // ignore malformed line
    }
  };

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return { ok: false, error: '已取消' };
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) flushLine(line);
  }

  flushLine(buffer);
  if (streamError) return { ok: false, error: streamError };
  return { ok: true };
}

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
  createTag: (body: { name: string; color?: string; parentId?: number }) => json<Tag>('/api/tags', { method: 'POST', body: JSON.stringify(body) }),
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
    bySchema: Array<{ dataSourceId: string; schemaName: string; count: number }>;
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
  })}`) as Promise<DataSearchResponse>,

  deepSearchLightSchemaDataStream: async (
    body: {
      q: string;
      dataSourceId: string;
      schemaName: string;
      tableNames?: string[];
    },
    onEvent: (event: DeepSearchEvent) => void,
    signal?: AbortSignal,
  ) => {
    const response = await fetch('/api/light-schemas/deep-data-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return consumeNdjsonStream(response, onEvent, signal);
  },

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
