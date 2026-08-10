/**
 * Chart placeholder construction and placement helpers.
 * Marker format: @ec@<marker>:<id>@ec@  (marker defaults to chart type or agent config)
 */
export declare const EC_MARKER_RE: RegExp;
export declare const EC_PARTIAL_OPEN = "@ec@";
import type { ChartRole } from '@/utils/autoChartRules/types';
export type PlacementChart = {
    chartId: string;
    role: ChartRole;
    marker?: string;
    /** Prefer bar/line/pie for legacy-compatible markers when marker omitted */
    typeHint?: string;
};
export declare function buildPlaceholder(marker: string | undefined, chartId: string, typeHint?: string): string;
/** Strip all @ec@...@ec@ markers from text (for multi-turn history isolation). */
export declare function stripChartPlaceholders(text: string): string;
/**
 * Insert placeholders before the first visible paragraph of body text.
 * If text is empty, returns placeholders joined by newlines.
 */
export declare function placePrepend(text: string, placeholders: string[]): string;
/**
 * Insert a placeholder near the matching semantic section heading.
 * If no section found, append at end of buffer.
 */
export declare function placeSemantic(text: string, placeholder: string, role: ChartRole): string;
export type PlacementBufferState = {
    text: string;
    pendingPlaceholders: string[];
    roles: ChartRole[];
    active: boolean;
};
/**
 * Streaming buffer keyed by stepId for semantic placement.
 */
export declare class ChartPlacementBufferMap {
    private buffers;
    getOrCreate(stepId: string): PlacementBufferState;
    activate(stepId: string, placeholders: string[], roles: ChartRole[]): void;
    /**
     * Push a text delta. When buffering is active, accumulate and return null
     * (caller should not dispatch yet). When inactive, return delta unchanged.
     */
    pushDelta(stepId: string, delta: string): string | null;
    /**
     * Flush remaining buffer: apply semantic placement then return final text.
     */
    flush(stepId: string): string;
    flushAll(): Map<string, string>;
    clear(): void;
}
