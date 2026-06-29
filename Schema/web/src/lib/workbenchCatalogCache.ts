export type WorkbenchSchemaEntry = {
  schemaName: string;
  tableCount?: number | null;
};

export type WorkbenchCatalogCache = {
  schemas: WorkbenchSchemaEntry[];
  tablesBySchema: Record<string, string[]>;
  fetchedAt: string;
  lastSchemaName?: string;
};

const STORAGE_KEY = 'schema-workbench-catalog-v1';

function cacheKey(dataSourceId: string) {
  return `${STORAGE_KEY}:${dataSourceId}`;
}

export function loadWorkbenchCatalog(dataSourceId: string): WorkbenchCatalogCache | null {
  if (typeof window === 'undefined' || !dataSourceId) return null;
  try {
    const raw = localStorage.getItem(cacheKey(dataSourceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkbenchCatalogCache;
    if (!Array.isArray(parsed.schemas)) return null;
    return {
      schemas: parsed.schemas,
      tablesBySchema: parsed.tablesBySchema && typeof parsed.tablesBySchema === 'object'
        ? parsed.tablesBySchema
        : {},
      fetchedAt: parsed.fetchedAt || '',
      lastSchemaName: parsed.lastSchemaName,
    };
  } catch {
    return null;
  }
}

export function saveWorkbenchCatalog(dataSourceId: string, cache: WorkbenchCatalogCache) {
  if (typeof window === 'undefined' || !dataSourceId) return;
  localStorage.setItem(cacheKey(dataSourceId), JSON.stringify(cache));
}

export function clearWorkbenchCatalog(dataSourceId: string) {
  if (typeof window === 'undefined' || !dataSourceId) return;
  localStorage.removeItem(cacheKey(dataSourceId));
}

export function patchWorkbenchCatalog(
  dataSourceId: string,
  patch: Partial<WorkbenchCatalogCache>,
): WorkbenchCatalogCache {
  const prev = loadWorkbenchCatalog(dataSourceId) || {
    schemas: [],
    tablesBySchema: {},
    fetchedAt: '',
  };
  const next: WorkbenchCatalogCache = {
    ...prev,
    ...patch,
    tablesBySchema: {
      ...prev.tablesBySchema,
      ...(patch.tablesBySchema || {}),
    },
    fetchedAt: patch.fetchedAt || prev.fetchedAt || new Date().toISOString(),
  };
  saveWorkbenchCatalog(dataSourceId, next);
  return next;
}

export function formatCatalogFetchedAt(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
