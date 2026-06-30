export type SkippedTableRecord = {
  tableName: string;
  error: string;
  reason?: string;
  elapsedMs?: number;
  columnCount?: number;
};

export type SlowTableRecord = {
  tableName: string;
  elapsedMs: number;
  columnCount?: number;
  reason: 'timeout' | 'skipped_by_user' | 'slow_success' | 'generate_failed';
  error?: string;
};

export type TableTimeoutMinutes = 0 | 5 | 10 | 20;

export type WorkbenchGenJob = {
  dataSourceId: string;
  schemaName: string;
  tableNames: string[];
  completedTables: string[];
  failedTables: SkippedTableRecord[];
  slowTables: SlowTableRecord[];
  currentTable?: string;
  currentIndex: number;
  status: 'running' | 'cancelled' | 'done' | 'interrupted';
  startedAt: string;
  updatedAt: string;
  sampleLimit: number;
  sampleScope: 'text_only' | 'all_columns';
  skipEmptyTables: boolean;
  tableTimeoutMinutes: TableTimeoutMinutes;
};

const STORAGE_KEY = 'schema-workbench-gen-job-v1';

function cacheKey(dataSourceId: string) {
  return `${STORAGE_KEY}:${dataSourceId}`;
}

export function loadGenJob(dataSourceId: string): WorkbenchGenJob | null {
  if (typeof window === 'undefined' || !dataSourceId) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(dataSourceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkbenchGenJob;
    if (parsed.dataSourceId !== dataSourceId || !Array.isArray(parsed.tableNames)) return null;
    return {
      ...parsed,
      slowTables: Array.isArray(parsed.slowTables) ? parsed.slowTables : [],
      tableTimeoutMinutes: parsed.tableTimeoutMinutes ?? 0,
    };
  } catch {
    return null;
  }
}

export function saveGenJob(job: WorkbenchGenJob) {
  if (typeof window === 'undefined' || !job.dataSourceId) return;
  sessionStorage.setItem(cacheKey(job.dataSourceId), JSON.stringify({
    ...job,
    updatedAt: new Date().toISOString(),
  }));
}

export function clearGenJob(dataSourceId: string) {
  if (typeof window === 'undefined' || !dataSourceId) return;
  sessionStorage.removeItem(cacheKey(dataSourceId));
}

export function markGenJobInterrupted(dataSourceId: string): WorkbenchGenJob | null {
  const job = loadGenJob(dataSourceId);
  if (!job || job.status !== 'running') return job;
  const next: WorkbenchGenJob = { ...job, status: 'interrupted' };
  saveGenJob(next);
  return next;
}

export function formatElapsed(ms: number): string {
  const n = Math.max(0, Math.round(ms));
  if (n < 1000) return `${n}ms`;
  const s = Math.floor(n / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}分${rs}秒` : `${m}分`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}小时${rm}分` : `${h}小时`;
}

/** 已成功 + 已跳过/失败，续跑时不再重试这些表 */
export function processedTableNames(job: Pick<WorkbenchGenJob, 'completedTables' | 'failedTables'>) {
  return new Set([
    ...job.completedTables,
    ...(job.failedTables || []).map((f) => f.tableName),
  ]);
}

export function pendingTableNames(job: WorkbenchGenJob) {
  const done = processedTableNames(job);
  return job.tableNames.filter((t) => !done.has(t));
}

/** 带超时的 fetch；超时后 abort 并吞掉迟到的 rejection，避免 unhandled rejection */
export async function fetchWithTableTimeout<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  controller: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fetchPromise = fetchFn(controller.signal);

  try {
    if (timeoutMs <= 0) return await fetchPromise;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error(timeoutMessage), { reason: 'timeout' }));
      }, timeoutMs);
    });

    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    fetchPromise.catch(() => {});
  }
}
