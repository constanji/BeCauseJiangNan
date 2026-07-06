export type PreviewRow = Record<string, unknown>;

export type PreviewRowsPayload = {
  columns: string[];
  rows: PreviewRow[];
  truncated: boolean;
  limit: number;
  filtered?: boolean;
};

type CachedPreview = PreviewRowsPayload & {
  fetchedAt: string;
};

const DATA_KEY = 'review-table-data-v1';
const FILTERS_KEY = 'review-table-filters-v1';
const TTL_MS = 5 * 60 * 1000;

function dataCacheKey(catalogId: number) {
  return `${DATA_KEY}:${catalogId}`;
}

function filtersCacheKey(catalogId: number) {
  return `${FILTERS_KEY}:${catalogId}`;
}

export function loadCachedPreviewRows(catalogId: number): PreviewRowsPayload | null {
  if (typeof window === 'undefined' || !catalogId) return null;
  try {
    const raw = sessionStorage.getItem(dataCacheKey(catalogId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPreview;
    if (!parsed?.fetchedAt || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > TTL_MS) {
      sessionStorage.removeItem(dataCacheKey(catalogId));
      return null;
    }
    return {
      columns: parsed.columns,
      rows: parsed.rows,
      truncated: Boolean(parsed.truncated),
      limit: Number(parsed.limit) || 100,
      filtered: false,
    };
  } catch {
    return null;
  }
}

export function saveCachedPreviewRows(catalogId: number, payload: PreviewRowsPayload) {
  if (typeof window === 'undefined' || !catalogId) return;
  const cached: CachedPreview = {
    ...payload,
    fetchedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(dataCacheKey(catalogId), JSON.stringify(cached));
}

export function loadSavedFilters(catalogId: number): Record<string, string> {
  if (typeof window === 'undefined' || !catalogId) return {};
  try {
    const raw = sessionStorage.getItem(filtersCacheKey(catalogId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFilters(catalogId: number, filtersByColumn: Record<string, string>) {
  if (typeof window === 'undefined' || !catalogId) return;
  sessionStorage.setItem(filtersCacheKey(catalogId), JSON.stringify(filtersByColumn));
}

export function hasActiveFilters(filtersByColumn: Record<string, string>) {
  return Object.values(filtersByColumn).some((value) => value.trim().length > 0);
}

export function filtersToRequest(filtersByColumn: Record<string, string>) {
  return Object.entries(filtersByColumn)
    .map(([column, value]) => ({ column, value: value.trim() }))
    .filter((item) => item.value.length > 0);
}
