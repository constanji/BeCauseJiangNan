import type { SummarizationTrigger } from '@/types/summarize';
/**
 * Determines whether summarization should be triggered based on the configured trigger
 * and current context state.
 *
 * Default behavior (no trigger configured): returns `true` whenever messages were pruned.
 * This is intentional — when an admin enables summarization without specifying a trigger,
 * summarization fires on any context overflow that causes pruning.
 *
 * When a trigger IS configured but required runtime data is missing (e.g., maxContextTokens
 * unavailable for a token_ratio trigger), returns `false` — we cannot evaluate the condition,
 * so we do not fire.
 */
export declare function shouldTriggerSummarization(params: {
    trigger?: SummarizationTrigger;
    maxContextTokens?: number;
    prePruneContextTokens?: number;
    remainingContextTokens?: number;
    messagesToRefineCount: number;
}): boolean;
