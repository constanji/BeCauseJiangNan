/**
 * KPI SQL field dictionary + comparison-basis selection.
 * Shared by auto-chart rules (agents-because) and API consumers via
 * `require('@because/agents')` — keep this module free of LangChain deps.
 */
export type BaselineGroupId = 'yd' | 'm_begin' | 'q_begin' | 'y_begin' | 'ly';
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
export declare const NUMERIC_FIELD_BLACKLIST: Set<string>;
/** Current-value column — strict match only, no "first numeric" fallback. */
export declare const INDEX_VALUE_FIELD = "index_value";
/**
 * Five baseline groups in display order:
 * 上年同期 → 上年末 → 上季末 → 上月末 → 上一日
 */
export declare const BASELINE_GROUPS: readonly BaselineGroup[];
/** Legacy alias: baseline field names only (ordered like TIME_COMPARE_FIELDS). */
export declare const TIME_COMPARE_FIELDS: readonly ["yd_value", "m_begin_value", "q_begin_value", "y_begin_value", "ly_value"];
export type RowRecord = Record<string, unknown>;
/** Resolve actual column name on a row (case-insensitive). */
export declare function resolveColumnName(row: RowRecord, canonical: string): string | undefined;
export declare function hasIndexValue(row: RowRecord): boolean;
export declare function getIndexValue(row: RowRecord): number | null;
/**
 * Return baseline groups that have a non-empty baseline value on the row,
 * ordered: 上年同期 → 上年末 → 上季末 → 上月末 → 上一日.
 */
export declare function pickAvailableBaselineGroups(row: RowRecord): BaselineGroup[];
/**
 * Select comparison basis by priority:
 * 1. User-question keyword hits a group that exists on the row
 * 2. Exactly one complete group available
 * 3. Prefer m_begin_* when present
 * 4. First available group in display order
 * Returns null when no baseline group is present.
 */
export declare function selectComparisonBasis(userQuestion: string | undefined | null, row: RowRecord): BaselineGroup | null;
/**
 * Prefer `*_change_value`; fall back to `index_value - baseline`.
 * `*_change_ratio` is already a percentage — callers must not ×100.
 */
export declare function resolveChangeValue(row: RowRecord, group: BaselineGroup): number | null;
export declare function resolveChangeRatio(row: RowRecord, group: BaselineGroup): number | null;
export declare function isBlacklistedNumericField(col: string): boolean;
export declare function isBaselineField(col: string): boolean;
export declare function isIndexValueField(col: string): boolean;
/** Barrel-friendly namespace export for smoke tests / require('@because/agents'). */
export declare const kpiFieldDictionary: {
    INDEX_VALUE_FIELD: string;
    NUMERIC_FIELD_BLACKLIST: Set<string>;
    BASELINE_GROUPS: readonly BaselineGroup[];
    TIME_COMPARE_FIELDS: readonly ["yd_value", "m_begin_value", "q_begin_value", "y_begin_value", "ly_value"];
    pickAvailableBaselineGroups: typeof pickAvailableBaselineGroups;
    selectComparisonBasis: typeof selectComparisonBasis;
    resolveChangeValue: typeof resolveChangeValue;
    resolveChangeRatio: typeof resolveChangeRatio;
    hasIndexValue: typeof hasIndexValue;
    getIndexValue: typeof getIndexValue;
    isBlacklistedNumericField: typeof isBlacklistedNumericField;
    isBaselineField: typeof isBaselineField;
    isIndexValueField: typeof isIndexValueField;
    resolveColumnName: typeof resolveColumnName;
};
export default kpiFieldDictionary;
