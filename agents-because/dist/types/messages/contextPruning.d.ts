/**
 * Position-based context pruning for tool results.
 *
 * Uses position-based age: the distance of a message
 * from the conversation end as a fraction of total messages.
 *
 * Two degradation levels:
 * - Soft-trim: Keep head + tail of tool result content, drop middle.
 * - Hard-clear: Replace entire content with a placeholder.
 *
 * Messages in the "protected zone" (recent assistant turns, system/pre-first-human
 * messages, and messages with image content) are never pruned.
 */
import { type BaseMessage } from '@langchain/core/messages';
import type { ContextPruningConfig } from '@/types/graph';
import type { TokenCounter } from '@/types/run';
import type { ContextPruningSettings } from './contextPruningSettings';
export interface ContextPruningResult {
    /** Number of messages that were soft-trimmed. */
    softTrimmed: number;
    /** Number of messages that were hard-cleared. */
    hardCleared: number;
}
/**
 * Applies position-based context pruning to tool result messages.
 *
 * Modifies messages in-place and updates indexTokenCountMap with recounted
 * token values for modified messages.
 *
 * @param params.messages - The full message array (modified in-place).
 * @param params.indexTokenCountMap - Token count map (updated in-place).
 * @param params.tokenCounter - Function to recount tokens after modification.
 * @param params.config - Partial context pruning config (merged with defaults).
 * @returns Counts of soft-trimmed and hard-cleared messages.
 */
export declare function applyContextPruning(params: {
    messages: BaseMessage[];
    indexTokenCountMap: Record<string, number | undefined>;
    tokenCounter: TokenCounter;
    config?: ContextPruningConfig;
    resolvedSettings?: ContextPruningSettings;
}): ContextPruningResult;
