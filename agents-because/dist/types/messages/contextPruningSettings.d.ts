import type { ContextPruningConfig } from '@/types/graph';
/** Resolved numeric/string settings for {@link applyContextPruning}. */
export interface ContextPruningSettings {
    enabled: boolean;
    keepLastAssistants: number;
    softTrimRatio: number;
    hardClearRatio: number;
    minPrunableToolChars: number;
    softTrim: {
        maxChars: number;
        headChars: number;
        tailChars: number;
    };
    hardClear: {
        enabled: boolean;
        placeholder: string;
    };
}
/**
 * Merges partial YAML / graph config with defaults for position-based tool pruning.
 */
export declare function resolveContextPruningSettings(config?: ContextPruningConfig): ContextPruningSettings;
