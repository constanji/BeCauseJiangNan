/**
 * KPI SQL field dictionary + comparison-basis selection.
 * Shared by auto-chart rules (agents-because) and API consumers via
 * `require('@because/agents')` — keep this module free of LangChain deps.
 */

export type BaselineGroupId =
  | 'yd'
  | 'm_begin'
  | 'q_begin'
  | 'y_begin'
  | 'ly';

export type BaselineGroup = {
  id: BaselineGroupId;
  /** Canonical baseline column, e.g. m_begin_value */
  baseline: string;
  /** Absolute change column, e.g. m_begin_change_value */
  changeValue: string;
  /** Ratio/change-rate column (already a percentage, do NOT ×100) */
  changeRatio: string;
  /** Display label for axis / legends */
  label: string;
  /** Keywords that prefer this group when matching user questions */
  keywords: string[];
};

/** Explicit numeric-sequence blacklist — never treat as chart measures. */
export const NUMERIC_FIELD_BLACKLIST = new Set(['curr_code', 'mea_unit']);

/** Current-value column — strict match only, no "first numeric" fallback. */
export const INDEX_VALUE_FIELD = 'index_value';

/**
 * Five baseline groups in display order:
 * 上年同期 → 上年末 → 上季末 → 上月末 → 上一日
 */
export const BASELINE_GROUPS: readonly BaselineGroup[] = [
  {
    id: 'ly',
    baseline: 'ly_value',
    changeValue: 'ly_change_value',
    changeRatio: 'ly_change_ratio',
    label: '上年同期',
    keywords: ['同比', '上年同期', '去年同期', '同期', 'ly'],
  },
  {
    id: 'y_begin',
    baseline: 'y_begin_value',
    changeValue: 'y_begin_change_value',
    changeRatio: 'y_begin_change_ratio',
    label: '上年末',
    keywords: ['较年初', '年初', '上年末', '年比', 'y_begin'],
  },
  {
    id: 'q_begin',
    baseline: 'q_begin_value',
    changeValue: 'q_begin_change_value',
    changeRatio: 'q_begin_change_ratio',
    label: '上季末',
    keywords: ['较季初', '季初', '上季末', '季比', 'q_begin'],
  },
  {
    id: 'm_begin',
    baseline: 'm_begin_value',
    changeValue: 'm_begin_change_value',
    changeRatio: 'm_begin_change_ratio',
    label: '上月末',
    keywords: ['较月初', '月初', '上月末', '月比', '环比', 'm_begin'],
  },
  {
    id: 'yd',
    baseline: 'yd_value',
    changeValue: 'yd_change_value',
    changeRatio: 'yd_change_ratio',
    label: '上一日',
    keywords: ['较上日', '上日', '日比', '日环比', 'yd'],
  },
] as const;

/** Legacy alias: baseline field names only (ordered like TIME_COMPARE_FIELDS). */
export const TIME_COMPARE_FIELDS = [
  'yd_value',
  'm_begin_value',
  'q_begin_value',
  'y_begin_value',
  'ly_value',
] as const;

export type RowRecord = Record<string, unknown>;

function isNonEmpty(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return false;
  }
  return true;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, '').replace(/%$/, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Resolve actual column name on a row (case-insensitive). */
export function resolveColumnName(
  row: RowRecord,
  canonical: string,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(row, canonical)) {
    return canonical;
  }
  const lower = canonical.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lower) {
      return key;
    }
  }
  return undefined;
}

export function hasIndexValue(row: RowRecord): boolean {
  const col = resolveColumnName(row, INDEX_VALUE_FIELD);
  return col != null && isNonEmpty(row[col]);
}

export function getIndexValue(row: RowRecord): number | null {
  const col = resolveColumnName(row, INDEX_VALUE_FIELD);
  if (!col) {
    return null;
  }
  return toNumber(row[col]);
}

/**
 * Return baseline groups that have a non-empty baseline value on the row,
 * ordered: 上年同期 → 上年末 → 上季末 → 上月末 → 上一日.
 */
export function pickAvailableBaselineGroups(row: RowRecord): BaselineGroup[] {
  const available: BaselineGroup[] = [];
  for (const group of BASELINE_GROUPS) {
    const col = resolveColumnName(row, group.baseline);
    if (col != null && isNonEmpty(row[col])) {
      available.push(group);
    }
  }
  return available;
}

/**
 * Select comparison basis by priority:
 * 1. User-question keyword hits a group that exists on the row
 * 2. Exactly one complete group available
 * 3. Prefer m_begin_* when present
 * 4. First available group in display order
 * Returns null when no baseline group is present.
 */
export function selectComparisonBasis(
  userQuestion: string | undefined | null,
  row: RowRecord,
): BaselineGroup | null {
  const available = pickAvailableBaselineGroups(row);
  if (available.length === 0) {
    return null;
  }

  const q = (userQuestion ?? '').toLowerCase();
  if (q) {
    for (const group of available) {
      if (group.keywords.some((kw) => q.includes(kw.toLowerCase()))) {
        return group;
      }
    }
  }

  if (available.length === 1) {
    return available[0];
  }

  const mBegin = available.find((g) => g.id === 'm_begin');
  if (mBegin) {
    return mBegin;
  }

  return available[0];
}

/**
 * Prefer `*_change_value`; fall back to `index_value - baseline`.
 * `*_change_ratio` is already a percentage — callers must not ×100.
 */
export function resolveChangeValue(
  row: RowRecord,
  group: BaselineGroup,
): number | null {
  const changeCol = resolveColumnName(row, group.changeValue);
  if (changeCol != null && isNonEmpty(row[changeCol])) {
    return toNumber(row[changeCol]);
  }

  const baselineCol = resolveColumnName(row, group.baseline);
  const index = getIndexValue(row);
  const baseline =
    baselineCol != null ? toNumber(row[baselineCol]) : null;
  if (index != null && baseline != null) {
    return index - baseline;
  }
  return null;
}

export function resolveChangeRatio(
  row: RowRecord,
  group: BaselineGroup,
): number | null {
  const col = resolveColumnName(row, group.changeRatio);
  if (col == null || !isNonEmpty(row[col])) {
    return null;
  }
  return toNumber(row[col]);
}

export function isBlacklistedNumericField(col: string): boolean {
  return NUMERIC_FIELD_BLACKLIST.has(col) ||
    NUMERIC_FIELD_BLACKLIST.has(col.toLowerCase());
}

export function isBaselineField(col: string): boolean {
  const lower = col.toLowerCase();
  return BASELINE_GROUPS.some(
    (g) =>
      g.baseline === lower ||
      g.changeValue === lower ||
      g.changeRatio === lower,
  );
}

export function isIndexValueField(col: string): boolean {
  return col.toLowerCase() === INDEX_VALUE_FIELD;
}

/** Barrel-friendly namespace export for smoke tests / require('@because/agents'). */
export const kpiFieldDictionary = {
  INDEX_VALUE_FIELD,
  NUMERIC_FIELD_BLACKLIST,
  BASELINE_GROUPS,
  TIME_COMPARE_FIELDS,
  pickAvailableBaselineGroups,
  selectComparisonBasis,
  resolveChangeValue,
  resolveChangeRatio,
  hasIndexValue,
  getIndexValue,
  isBlacklistedNumericField,
  isBaselineField,
  isIndexValueField,
  resolveColumnName,
};

export default kpiFieldDictionary;
