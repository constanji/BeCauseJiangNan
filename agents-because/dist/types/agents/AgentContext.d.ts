import { SystemMessage } from '@langchain/core/messages';
import type { UsageMetadata, BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig, Runnable } from '@langchain/core/runnables';
import type { createPruneMessages } from '@/messages';
import type * as t from '@/types';
import { ContentTypes, Providers } from '@/common';
/**
 * Encapsulates agent-specific state that can vary between agents in a multi-agent system
 */
export declare class AgentContext {
    /**
     * Create an AgentContext from configuration with token accounting initialization
     */
    static fromConfig(agentConfig: t.AgentInputs, tokenCounter?: t.TokenCounter, indexTokenCountMap?: Record<string, number>): AgentContext;
    /** Agent identifier */
    agentId: string;
    /** Human-readable name for this agent (used in handoff context). Falls back to agentId if not provided. */
    name?: string;
    /** Provider for this specific agent */
    provider: Providers;
    /** Client options for this agent */
    clientOptions?: t.ClientOptions;
    /** Token count map indexed by message position */
    indexTokenCountMap: Record<string, number | undefined>;
    /** Canonical pre-run token map used to restore token accounting on reset */
    baseIndexTokenCountMap: Record<string, number>;
    /** Maximum context tokens for this agent */
    maxContextTokens?: number;
    /** Current usage metadata for this agent */
    currentUsage?: Partial<UsageMetadata>;
    /**
     * Usage from the most recent LLM call only (not accumulated).
     * Used for accurate provider calibration in pruning.
     */
    lastCallUsage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cacheRead?: number;
        cacheCreation?: number;
    };
    /**
     * Whether totalTokens data is fresh (set true when provider usage arrives,
     * false at the start of each turn before the LLM responds).
     * Prevents stale token data from driving pruning/trigger decisions.
     */
    totalTokensFresh: boolean;
    /** Context pruning configuration. */
    contextPruningConfig?: t.ContextPruningConfig;
    maxToolResultChars?: number;
    /** Prune messages function configured for this agent */
    pruneMessages?: ReturnType<typeof createPruneMessages>;
    /** Token counter function for this agent */
    tokenCounter?: t.TokenCounter;
    /** Token count for the system message (instructions text). */
    systemMessageTokens: number;
    /** Token count for tool schemas only. */
    toolSchemaTokens: number;
    /** Running calibration ratio from the pruner — persisted across runs via contextMeta. */
    calibrationRatio: number;
    /** Provider-observed instruction overhead from the pruner's best-variance turn. */
    resolvedInstructionOverhead?: number;
    /** Pre-masking tool content keyed by message index, consumed by the summarize node. */
    pendingOriginalToolContent?: Map<number, string>;
    /** Total instruction overhead: system message + tool schemas + pending summary. */
    get instructionTokens(): number;
    /** The amount of time that should pass before another consecutive API call */
    streamBuffer?: number;
    /** Last stream call timestamp for rate limiting */
    lastStreamCall?: number;
    /** Tools available to this agent */
    tools?: t.GraphTools;
    /** Graph-managed tools (e.g., handoff tools created by MultiAgentGraph) that bypass event-driven dispatch */
    graphTools?: t.GraphTools;
    /** Tool map for this agent */
    toolMap?: t.ToolMap;
    /**
     * Tool definitions registry (includes deferred and programmatic tool metadata).
     * Used for tool search and programmatic tool calling.
     */
    toolRegistry?: t.LCToolRegistry;
    /**
     * Serializable tool definitions for event-driven execution.
     * When provided, ToolNode operates in event-driven mode.
     */
    toolDefinitions?: t.LCTool[];
    /** Set of tool names discovered via tool search (to be loaded) */
    discoveredToolNames: Set<string>;
    /** Instructions for this agent */
    instructions?: string;
    /** Additional instructions for this agent */
    additionalInstructions?: string;
    /** Reasoning key for this agent */
    reasoningKey: 'reasoning_content' | 'reasoning';
    /** Last token for reasoning detection */
    lastToken?: string;
    /** Token type switch state */
    tokenTypeSwitch?: 'reasoning' | 'content';
    /** Tracks how many reasoning→text transitions have occurred (ensures unique post-reasoning step keys) */
    reasoningTransitionCount: number;
    /** Current token type being processed */
    currentTokenType: ContentTypes.TEXT | ContentTypes.THINK | 'think_and_text';
    /** Whether tools should end the workflow */
    toolEnd: boolean;
    /** Cached system runnable (created lazily) */
    private cachedSystemRunnable?;
    /** Whether system runnable needs rebuild (set when discovered tools change) */
    private systemRunnableStale;
    /** Promise for token calculation initialization */
    tokenCalculationPromise?: Promise<void>;
    /** Format content blocks as strings (for legacy compatibility) */
    useLegacyContent: boolean;
    /** Enables graph-level summarization for this agent */
    summarizationEnabled?: boolean;
    /** Summarization runtime settings used by graph pruning hooks */
    summarizationConfig?: t.SummarizationConfig;
    /** Current summary text produced by the summarize node, integrated into system message */
    private summaryText?;
    /** Token count of the current summary (tracked for token accounting) */
    private summaryTokenCount;
    /**
     * Where the summary should be injected:
     * - `'system_prompt'`: cross-run summary, included in `buildInstructionsString`
     * - `'user_message'`: mid-run compaction, injected as HumanMessage on clean slate
     * - `'none'`: no summary present
     */
    private _summaryLocation;
    /**
     * Durable summary that survives reset() calls. Set from initialSummary
     * during fromConfig() and updated by setSummary() so that the latest
     * summary (whether cross-run or intra-run) is always restored after
     * processStream's resetValues() cycle.
     */
    private _durableSummaryText?;
    private _durableSummaryTokenCount;
    /** Number of summarization cycles that have occurred for this agent context */
    private _summaryVersion;
    /**
     * Message count at the time summarization was last triggered.
     * Used to prevent re-summarizing the same unchanged message set.
     * Summarization is allowed to fire again only when new messages appear.
     */
    private _lastSummarizationMsgCount;
    /**
     * Handoff context when this agent receives control via handoff.
     * Contains source and parallel execution info for system message context.
     */
    handoffContext?: {
        /** Source agent that transferred control */
        sourceAgentName: string;
        /** Names of sibling agents executing in parallel (empty if sequential) */
        parallelSiblings: string[];
    };
    constructor({ agentId, name, provider, clientOptions, maxContextTokens, streamBuffer, tokenCounter, tools, toolMap, toolRegistry, toolDefinitions, instructions, additionalInstructions, reasoningKey, toolEnd, instructionTokens, useLegacyContent, discoveredTools, summarizationEnabled, summarizationConfig, contextPruningConfig, maxToolResultChars, }: {
        agentId: string;
        name?: string;
        provider: Providers;
        clientOptions?: t.ClientOptions;
        maxContextTokens?: number;
        streamBuffer?: number;
        tokenCounter?: t.TokenCounter;
        tools?: t.GraphTools;
        toolMap?: t.ToolMap;
        toolRegistry?: t.LCToolRegistry;
        toolDefinitions?: t.LCTool[];
        instructions?: string;
        additionalInstructions?: string;
        reasoningKey?: 'reasoning_content' | 'reasoning';
        toolEnd?: boolean;
        instructionTokens?: number;
        useLegacyContent?: boolean;
        discoveredTools?: string[];
        summarizationEnabled?: boolean;
        summarizationConfig?: t.SummarizationConfig;
        contextPruningConfig?: t.ContextPruningConfig;
        maxToolResultChars?: number;
    });
    /**
     * Builds instructions text for tools that are ONLY callable via programmatic code execution.
     * These tools cannot be called directly by the LLM but are available through the
     * run_tools_with_code tool.
     *
     * Includes:
     * - Code_execution-only tools that are NOT deferred
     * - Code_execution-only tools that ARE deferred but have been discovered via tool search
     */
    private buildProgrammaticOnlyToolsInstructions;
    /**
     * Gets the system runnable, creating it lazily if needed.
     * Includes instructions, additional instructions, and programmatic-only tools documentation.
     * Only rebuilds when marked stale (via markToolsAsDiscovered).
     */
    get systemRunnable(): Runnable<BaseMessage[], (BaseMessage | SystemMessage)[], RunnableConfig<Record<string, unknown>>> | undefined;
    /**
     * Explicitly initializes the system runnable.
     * Call this before async token calculation to ensure system message tokens are counted first.
     */
    initializeSystemRunnable(): void;
    /**
     * Builds the raw instructions string (without creating SystemMessage).
     * Includes agent identity preamble and handoff context when available.
     */
    private buildInstructionsString;
    /**
     * Builds the agent identity preamble including handoff context if present.
     * This helps the agent understand its role in the multi-agent workflow.
     */
    private buildIdentityPreamble;
    /**
     * Build system runnable from pre-built instructions string.
     * Only called when content has actually changed.
     */
    private buildSystemRunnable;
    /**
     * Reset context for a new run
     */
    reset(): void;
    /**
     * Update the token count map from a base map.
     *
     * Previously this inflated index 0 with instructionTokens to indirectly
     * reserve budget for the system prompt.  That approach was imprecise: with
     * large tool-schema overhead (e.g. 26 MCP tools ~5 000 tokens) the first
     * conversation message appeared enormous and was always pruned, while the
     * real available budget was never explicitly computed.
     *
     * Now instruction tokens are passed to getMessagesWithinTokenLimit via
     * the `getInstructionTokens` factory param so the pruner subtracts them
     * from the budget directly.  The token map contains only real per-message
     * token counts.
     */
    updateTokenMapWithInstructions(baseTokenMap: Record<string, number>): void;
    /**
     * Calculate tool tokens and add to instruction tokens
     * Note: System message tokens are calculated during systemRunnable creation
     */
    calculateInstructionTokens(tokenCounter: t.TokenCounter): Promise<void>;
    /**
     * Gets the tool registry for deferred tools (for tool search).
     * @param onlyDeferred If true, only returns tools with defer_loading=true
     * @returns LCToolRegistry with tool definitions
     */
    getDeferredToolRegistry(onlyDeferred?: boolean): t.LCToolRegistry;
    /**
     * Sets the handoff context for this agent.
     * Call this when the agent receives control via handoff from another agent.
     * Marks system runnable as stale to include handoff context in system message.
     * @param sourceAgentName - Name of the agent that transferred control
     * @param parallelSiblings - Names of other agents executing in parallel with this one
     */
    setHandoffContext(sourceAgentName: string, parallelSiblings: string[]): void;
    /**
     * Clears any handoff context.
     * Call this when resetting the agent or when handoff context is no longer relevant.
     */
    clearHandoffContext(): void;
    setSummary(text: string, tokenCount: number): void;
    /** Sets a cross-run summary that is injected into the system prompt. */
    setInitialSummary(text: string, tokenCount: number): void;
    /**
     * Replaces the indexTokenCountMap with a fresh map keyed to the surviving
     * context messages after summarization.  Called by the summarize node after
     * it emits RemoveMessage operations that shift message indices.
     */
    rebuildTokenMapAfterSummarization(newTokenMap: Record<string, number>): void;
    hasSummary(): boolean;
    /** True when a mid-run compaction summary is ready to be injected as a HumanMessage. */
    hasPendingCompactionSummary(): boolean;
    getSummaryText(): string | undefined;
    get summaryVersion(): number;
    /**
     * Returns true when the message count hasn't changed since the last
     * summarization — re-summarizing would produce an identical result.
     * Oversized individual messages are handled by fit-to-budget truncation
     * in the pruner, which keeps them in context without triggering overflow.
     */
    shouldSkipSummarization(currentMsgCount: number): boolean;
    /**
     * Records the message count at which summarization was triggered,
     * so subsequent calls with the same count are suppressed.
     */
    markSummarizationTriggered(msgCount: number): void;
    clearSummary(): void;
    /**
     * Returns a structured breakdown of how the context token budget is consumed.
     * Useful for diagnostics when context overflow or pruning issues occur.
     */
    getTokenBudgetBreakdown(messages?: BaseMessage[]): t.TokenBudgetBreakdown;
    /**
     * Returns a human-readable string of the token budget breakdown
     * for inclusion in error messages and diagnostics.
     */
    formatTokenBudgetBreakdown(messages?: BaseMessage[]): string;
    /**
     * Updates the last-call usage with data from the most recent LLM response.
     * Unlike `currentUsage` which accumulates, this captures only the single call.
     */
    updateLastCallUsage(usage: Partial<UsageMetadata>): void;
    /** Marks token data as stale before a new LLM call. */
    markTokensStale(): void;
    /**
     * Marks tools as discovered via tool search.
     * Discovered tools will be included in the next model binding.
     * Only marks system runnable stale if NEW tools were actually added.
     * @param toolNames - Array of discovered tool names
     * @returns true if any new tools were discovered
     */
    markToolsAsDiscovered(toolNames: string[]): boolean;
    /**
     * Gets tools that should be bound to the LLM.
     * In event-driven mode (toolDefinitions present, tools empty), creates schema-only tools.
     * Otherwise filters tool instances based on:
     * 1. Non-deferred tools with allowed_callers: ['direct']
     * 2. Discovered tools (from tool search)
     * @returns Array of tools to bind to model
     */
    getToolsForBinding(): t.GraphTools | undefined;
    /** Creates schema-only tools from toolDefinitions for event-driven mode, merged with native tools */
    private getEventDrivenToolsForBinding;
    /** Filters tool instances for binding based on registry config */
    private filterToolsForBinding;
}
