import { BaseMessage, UsageMetadata } from '@langchain/core/messages';
import type { TokenCounter } from '@/types/run';
import type { ContextPruningConfig } from '@/types/graph';
import { ContentTypes, Providers } from '@/common';
/** Default fraction of the token budget reserved as headroom (5 %). */
export declare const DEFAULT_RESERVE_RATIO = 0.05;
export type PruneMessagesFactoryParams = {
    provider?: Providers;
    maxTokens: number;
    startIndex: number;
    tokenCounter: TokenCounter;
    indexTokenCountMap: Record<string, number | undefined>;
    thinkingEnabled?: boolean;
    /** Context pruning configuration for position-based tool result degradation. */
    contextPruningConfig?: ContextPruningConfig;
    /**
     * When true, context pressure fading (pre-flight tool result truncation)
     * is skipped.  Summarization replaces pruning as the primary context
     * management strategy — the summarizer needs full un-truncated tool results
     * to produce an accurate summary.  Hard pruning still runs as a fallback
     * when summarization is skipped or capped.
     */
    summarizationEnabled?: boolean;
    /**
     * Returns the current instruction-token overhead (system message + tool schemas + summary).
     * Called on each prune invocation so the budget reflects dynamic changes
     * (e.g. summary added between turns).  When messages don't include a leading
     * SystemMessage, these tokens are subtracted from the available budget so
     * the pruner correctly reserves space for the system prompt that will be
     * prepended later by `buildSystemRunnable`.
     */
    getInstructionTokens?: () => number;
    /**
     * Fraction of the effective token budget to reserve as headroom (0–1).
     * When set, pruning triggers at `effectiveMax * (1 - reserveRatio)` instead of
     * filling the context window to 100%.  Defaults to 5 % (0.05) when omitted.
     */
    reserveRatio?: number;
    /**
     * Initial calibration ratio from a previous run's persisted contextMeta.
     * Seeds the running EMA so new messages are scaled immediately instead
     * of waiting for the first provider response.  Ignored when <= 0.
     */
    calibrationRatio?: number;
    /** Optional diagnostic log callback wired by the graph for observability. */
    log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void;
};
export type PruneMessagesParams = {
    messages: BaseMessage[];
    usageMetadata?: Partial<UsageMetadata>;
    startType?: ReturnType<BaseMessage['getType']>;
    /**
     * Usage from the most recent LLM call only (not accumulated).
     * When provided, calibration uses this instead of usageMetadata
     * to avoid inflated ratios from N×cacheRead accumulation.
     */
    lastCallUsage?: {
        totalTokens: number;
        inputTokens?: number;
    };
    /**
     * Whether the token data is fresh (from a just-completed LLM call).
     * When false, provider calibration is skipped to avoid applying
     * stale ratios.
     */
    totalTokensFresh?: boolean;
};
export declare function repairOrphanedToolMessages({ context, allMessages, tokenCounter, indexTokenCountMap, }: {
    context: BaseMessage[];
    allMessages: BaseMessage[];
    tokenCounter: TokenCounter;
    indexTokenCountMap: Record<string, number | undefined>;
}): {
    context: BaseMessage[];
    reclaimedTokens: number;
    droppedOrphanCount: number;
    /** Messages removed from context during orphan repair.  These should be
     *  appended to `messagesToRefine` so that summarization can still see them
     *  (e.g. a ToolMessage whose parent AI was pruned). */
    droppedMessages: BaseMessage[];
};
/**
 * Lightweight structural cleanup: strips orphan tool_use blocks from AI messages
 * and drops orphan ToolMessages whose AI counterpart is missing.
 *
 * Unlike `repairOrphanedToolMessages`, this does NOT track tokens — it is
 * intended as a final safety net in Graph.ts right before model invocation
 * to prevent Anthropic/Bedrock structural validation errors.
 *
 * Uses duck-typing instead of `getType()` because messages at this stage
 * may be plain objects (from LangGraph state serialization) rather than
 * proper BaseMessage class instances.
 *
 * Includes a fast-path: if every tool_call has a matching tool_result and
 * vice-versa, the original array is returned immediately with zero allocation.
 */
export declare function sanitizeOrphanToolBlocks(messages: BaseMessage[]): BaseMessage[];
/**
 * Calculates the total tokens from a single usage object
 *
 * @param usage The usage metadata object containing token information
 * @returns An object containing the total input and output tokens
 */
export declare function calculateTotalTokens(usage: Partial<UsageMetadata>): UsageMetadata;
export type PruningResult = {
    context: BaseMessage[];
    remainingContextTokens: number;
    messagesToRefine: BaseMessage[];
    thinkingStartIndex?: number;
};
/**
 * Processes an array of messages and returns a context of messages that fit within a specified token limit.
 * It iterates over the messages from newest to oldest, adding them to the context until the token limit is reached.
 *
 * @param options Configuration options for processing messages
 * @returns Object containing the message context, remaining tokens, messages not included, and summary index
 */
export declare function getMessagesWithinTokenLimit({ messages: _messages, maxContextTokens, indexTokenCountMap, startType: _startType, thinkingEnabled, tokenCounter, thinkingStartIndex: _thinkingStartIndex, reasoningType, instructionTokens: _instructionTokens, }: {
    messages: BaseMessage[];
    maxContextTokens: number;
    indexTokenCountMap: Record<string, number | undefined>;
    startType?: string | string[];
    thinkingEnabled?: boolean;
    tokenCounter: TokenCounter;
    thinkingStartIndex?: number;
    reasoningType?: ContentTypes.THINKING | ContentTypes.REASONING_CONTENT;
    /**
     * Token overhead for instructions (system message + tool schemas + summary)
     * that are NOT included in `messages`.  When messages[0] is already a
     * SystemMessage the budget is deducted from its indexTokenCountMap entry
     * as before; otherwise this value is subtracted from the available budget.
     */
    instructionTokens?: number;
}): PruningResult;
export declare function checkValidNumber(value: unknown): value is number;
/**
 * Observation masking: replaces consumed ToolMessage content with tight
 * head+tail truncations that serve as informative placeholders.
 *
 * A ToolMessage is "consumed" when a subsequent AI message exists that is NOT
 * purely tool calls — meaning the model has already read and acted on the
 * result. Unconsumed results (the latest tool outputs the model hasn't
 * responded to yet) are left intact so the model can still use them.
 *
 * AI messages are never masked — they contain the model's own reasoning and
 * conclusions, which is what prevents the model from repeating work after
 * its tool results are masked.
 *
 * @returns The number of tool messages that were masked.
 */
export declare function maskConsumedToolResults(params: {
    messages: BaseMessage[];
    indexTokenCountMap: Record<string, number | undefined>;
    tokenCounter: TokenCounter;
    /** Raw-space token budget available for all consumed tool results combined.
     *  When provided, the budget is distributed across consumed results weighted
     *  by recency (newest get the most, oldest get MASKED_RESULT_MAX_CHARS min).
     *  When omitted, falls back to a flat MASKED_RESULT_MAX_CHARS per result. */
    availableRawBudget?: number;
    /** When provided, original (pre-masking) content is stored here keyed by
     *  message index — only for entries that actually get truncated. */
    originalContentStore?: Map<number, string>;
    /** Called after storing content with the char length of the stored entry. */
    onContentStored?: (charLength: number) => void;
}): number;
/**
 * Pre-flight truncation: truncates oversized ToolMessage content before the
 * main backward-iteration pruning runs. Unlike the ingestion guard (which caps
 * at tool-execution time), pre-flight truncation applies per-turn based on the
 * current context window budget (which may have shrunk due to growing conversation).
 *
 * After truncation, recounts tokens via tokenCounter and updates indexTokenCountMap
 * so subsequent pruning works with accurate counts.
 *
 * @returns The number of tool messages that were truncated.
 */
export declare function preFlightTruncateToolResults(params: {
    messages: BaseMessage[];
    maxContextTokens: number;
    indexTokenCountMap: Record<string, number | undefined>;
    tokenCounter: TokenCounter;
}): number;
/**
 * Pre-flight truncation: truncates oversized `tool_use` input fields in AI messages.
 *
 * Tool call inputs (arguments) can be very large — e.g., code evaluation payloads from
 * MCP tools like chrome-devtools. Since these tool calls have already been executed,
 * the model only needs a summary of what was called, not the full arguments. Truncating
 * them before pruning can prevent entire messages from being dropped.
 *
 * Uses 15% of the context window (in estimated characters, ~4 chars/token) as the
 * per-input cap, capped at 200K chars.
 *
 * @returns The number of AI messages that had tool_use inputs truncated.
 */
export declare function preFlightTruncateToolCallInputs(params: {
    messages: BaseMessage[];
    maxContextTokens: number;
    indexTokenCountMap: Record<string, number | undefined>;
    tokenCounter: TokenCounter;
}): number;
export declare function createPruneMessages(factoryParams: PruneMessagesFactoryParams): (params: PruneMessagesParams) => {
    context: BaseMessage[];
    indexTokenCountMap: Record<string, number | undefined>;
    messagesToRefine?: BaseMessage[];
    prePruneContextTokens?: number;
    remainingContextTokens?: number;
    contextPressure?: number;
    originalToolContent?: Map<number, string>;
    calibrationRatio?: number;
    resolvedInstructionOverhead?: number;
};
