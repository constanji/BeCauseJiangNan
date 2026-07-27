import type { VersionRecord } from './types';

export type VersionChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type VersionChangeSummary = {
  kind: 'initial' | 'changes' | 'none';
  changes: VersionChange[];
};

const EMPTY = '（空）';
const TRUNCATE = 80;

function asText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, max = TRUNCATE): string {
  const t = value.trim();
  if (!t) return EMPTY;
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function displayScalar(value: unknown): string {
  const t = asText(value).trim();
  return t ? t : EMPTY;
}

function displayLong(value: unknown): string {
  const raw = asText(value);
  const trimmed = raw.trim();
  if (!trimmed) return EMPTY;
  const preview = truncateText(trimmed);
  if (trimmed.length <= TRUNCATE) return preview;
  return `${preview}（共 ${trimmed.length} 字）`;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (value == null || value === '') return [];
    return [String(value)];
  }
  return value.map((v) => String(v ?? '').trim()).filter(Boolean);
}

function sortedJoin(value: unknown): string {
  const list = normalizeList(value).sort((a, b) => a.localeCompare(b));
  return list.length ? list.join(', ') : EMPTY;
}

function toolsDiff(before: unknown, after: unknown): { before: string; after: string } {
  const a = new Set(normalizeList(before));
  const b = new Set(normalizeList(after));
  const added = [...b].filter((x) => !a.has(x)).sort();
  const removed = [...a].filter((x) => !b.has(x)).sort();
  const parts: string[] = [];
  if (added.length) parts.push(`+${added.join(', +')}`);
  if (removed.length) parts.push(`-${removed.join(', -')}`);
  const summary = parts.length ? parts.join(' ') : sortedJoin(after);
  return {
    before: sortedJoin(before),
    after: summary || sortedJoin(after),
  };
}

function modelLabel(v: VersionRecord | null | undefined): string {
  if (!v) return EMPTY;
  const provider = asText(v.provider).trim();
  const model = asText(v.model).trim();
  if (provider && model) return `${provider}/${model}`;
  if (model) return model;
  if (provider) return provider;
  return EMPTY;
}

function listsEqual(a: unknown, b: unknown): boolean {
  return sortedJoin(a) === sortedJoin(b);
}

/**
 * 比较相邻版本快照，生成带修改前后的变更摘要。
 * @param previous 上一版（更旧）；null 表示当前为初始版本
 * @param current 当前版
 */
export function getVersionChanges(
  previous: VersionRecord | null | undefined,
  current: VersionRecord | null | undefined,
): VersionChangeSummary {
  if (!current) {
    return { kind: 'none', changes: [] };
  }
  if (!previous) {
    return { kind: 'initial', changes: [] };
  }

  const changes: VersionChange[] = [];

  if (displayScalar(previous.name) !== displayScalar(current.name)) {
    changes.push({
      field: 'name',
      label: '修改了名字',
      before: displayScalar(previous.name),
      after: displayScalar(current.name),
    });
  }

  if (asText(previous.description).trim() !== asText(current.description).trim()) {
    changes.push({
      field: 'description',
      label: '修改了描述',
      before: displayLong(previous.description),
      after: displayLong(current.description),
    });
  }

  if (asText(previous.instructions).trim() !== asText(current.instructions).trim()) {
    changes.push({
      field: 'instructions',
      label: '修改了提示词',
      before: displayLong(previous.instructions),
      after: displayLong(current.instructions),
    });
  }

  if (!listsEqual(previous.tools, current.tools)) {
    const diff = toolsDiff(previous.tools, current.tools);
    changes.push({
      field: 'tools',
      label: '修改了挂载工具',
      before: diff.before,
      after: diff.after,
    });
  }

  if (modelLabel(previous) !== modelLabel(current)) {
    changes.push({
      field: 'model',
      label: '修改了模型',
      before: modelLabel(previous),
      after: modelLabel(current),
    });
  }

  if (!listsEqual(previous.capabilities, current.capabilities)) {
    changes.push({
      field: 'capabilities',
      label: '修改了能力',
      before: sortedJoin(previous.capabilities),
      after: sortedJoin(current.capabilities),
    });
  }

  if (changes.length === 0) {
    return { kind: 'none', changes: [] };
  }
  return { kind: 'changes', changes };
}

/**
 * 按时间升序排列后，为每个版本计算相对上一条的变更；返回 Map：version 引用 → summary
 * 展示列表仍可按降序使用同一 Map。
 */
export function buildVersionChangeMap(
  versionsChronological: VersionRecord[],
): Map<VersionRecord, VersionChangeSummary> {
  const map = new Map<VersionRecord, VersionChangeSummary>();
  for (let i = 0; i < versionsChronological.length; i++) {
    const prev = i === 0 ? null : versionsChronological[i - 1];
    const cur = versionsChronological[i];
    map.set(cur, getVersionChanges(prev, cur));
  }
  return map;
}

export function sortVersionsAscending(versions: VersionRecord[]): VersionRecord[] {
  return [...versions].sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return aTime - bTime;
  });
}
