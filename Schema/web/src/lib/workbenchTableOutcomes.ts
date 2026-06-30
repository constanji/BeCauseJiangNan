export type TableOutcomeReason =
  | 'empty_table'
  | 'timeout'
  | 'generate_failed'
  | 'row_count_failed'
  | 'skipped_by_user';

export type TableOutcome = {
  reason: TableOutcomeReason;
  error?: string;
  updatedAt: string;
};

export type TableListFilter = 'all' | 'ungenerated' | 'empty' | 'failed' | 'completed';

const STORAGE_KEY = 'schema-workbench-table-outcomes-v1';

function cacheKey(dataSourceId: string, schemaName: string) {
  return `${STORAGE_KEY}:${dataSourceId}:${schemaName}`;
}

export function loadTableOutcomes(dataSourceId: string, schemaName: string): Record<string, TableOutcome> {
  if (typeof window === 'undefined' || !dataSourceId || !schemaName) return {};
  try {
    const raw = sessionStorage.getItem(cacheKey(dataSourceId, schemaName));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TableOutcome>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveTableOutcomes(
  dataSourceId: string,
  schemaName: string,
  outcomes: Record<string, TableOutcome>,
) {
  if (typeof window === 'undefined' || !dataSourceId || !schemaName) return;
  if (Object.keys(outcomes).length === 0) {
    sessionStorage.removeItem(cacheKey(dataSourceId, schemaName));
    return;
  }
  sessionStorage.setItem(cacheKey(dataSourceId, schemaName), JSON.stringify(outcomes));
}

export function getTableCategory(
  tableName: string,
  generatedSet: Set<string>,
  outcomes: Record<string, TableOutcome>,
): Exclude<TableListFilter, 'all'> {
  if (generatedSet.has(tableName)) return 'completed';
  const outcome = outcomes[tableName];
  if (outcome?.reason === 'empty_table') return 'empty';
  if (outcome) return 'failed';
  return 'ungenerated';
}

export function mergeTableOutcomes(
  prev: Record<string, TableOutcome>,
  skipped: Array<{ tableName: string; reason?: string; error?: string }>,
  succeeded: string[],
): Record<string, TableOutcome> {
  const next = { ...prev };
  const updatedAt = new Date().toISOString();
  for (const item of skipped) {
    if (!item.reason) continue;
    next[item.tableName] = {
      reason: item.reason as TableOutcomeReason,
      error: item.error,
      updatedAt,
    };
  }
  for (const name of succeeded) {
    delete next[name];
  }
  return next;
}

export function countTablesByCategory(
  tables: string[],
  generatedSet: Set<string>,
  outcomes: Record<string, TableOutcome>,
) {
  const counts = {
    all: tables.length,
    ungenerated: 0,
    empty: 0,
    failed: 0,
    completed: 0,
  };
  for (const tableName of tables) {
    counts[getTableCategory(tableName, generatedSet, outcomes)] += 1;
  }
  return counts;
}
