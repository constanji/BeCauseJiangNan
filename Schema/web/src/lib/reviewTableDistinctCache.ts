export type DistinctValuesPayload = {
  column: string;
  values: string[];
  truncated: boolean;
  limit: number;
};

type CachedDistinct = DistinctValuesPayload & {
  fetchedAt: string;
};

const DISTINCT_KEY = 'review-table-distinct-v1';
const TTL_MS = 10 * 60 * 1000;

function cacheKey(catalogId: number, column: string) {
  return `${DISTINCT_KEY}:${catalogId}:${column}`;
}

export function loadCachedDistinctValues(catalogId: number, column: string): DistinctValuesPayload | null {
  if (typeof window === 'undefined' || !catalogId || !column) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(catalogId, column));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDistinct;
    if (!parsed?.fetchedAt || !Array.isArray(parsed.values)) return null;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > TTL_MS) {
      sessionStorage.removeItem(cacheKey(catalogId, column));
      return null;
    }
    return {
      column: parsed.column,
      values: parsed.values,
      truncated: Boolean(parsed.truncated),
      limit: Number(parsed.limit) || 200,
    };
  } catch {
    return null;
  }
}

export function saveCachedDistinctValues(catalogId: number, payload: DistinctValuesPayload) {
  if (typeof window === 'undefined' || !catalogId || !payload.column) return;
  const cached: CachedDistinct = {
    ...payload,
    fetchedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(cacheKey(catalogId, payload.column), JSON.stringify(cached));
}
