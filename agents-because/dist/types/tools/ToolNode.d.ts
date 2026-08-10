import { ToolCall } from '@langchain/core/messages/tool';
import { END, Command, MessagesAnnotation } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type * as t from '@/types';
import { RunnableCallable } from '@/utils';
export declare class ToolNode<T = any> extends RunnableCallable<T, T> {
    private toolMap;
    private loadRuntimeTools?;
    handleToolErrors: boolean;
    trace: boolean;
    toolCallStepIds?: Map<string, string>;
    errorHandler?: t.ToolNodeConstructorParams['errorHandler'];
    private toolUsageCount;
    /** Maps toolCallId → turn captured in runTool, used by handleRunToolCompletions */
    private toolCallTurns;
    /** Tool registry for filtering (lazy computation of programmatic maps) */
    private toolRegistry?;
    /** Cached programmatic tools (computed once on first PTC call) */
    private programmaticCache?;
    /** Reference to Graph's sessions map for automatic session injection */
    private sessions?;
    /** When true, dispatches ON_TOOL_EXECUTE events instead of invoking tools directly */
    private eventDrivenMode;
    /** Agent ID for event-driven mode */
    private agentId?;
    /** Tool names that bypass event dispatch and execute directly (e.g., graph-managed handoff tools) */
    private directToolNames?;
    /** Maximum characters allowed in a single tool result before truncation. */
    private maxToolResultChars;
    /** Optional callback to register synthetic tool calls in the UI stream */
    private dispatchSyntheticToolCall?;
    /** Graph-owned per-run chart registry */
    private chartRunRegistry?;
    constructor({ tools, toolMap, name, tags, errorHandler, toolCallStepIds, handleToolErrors, loadRuntimeTools, toolRegistry, toolDefinitions, sessions, eventDrivenMode, agentId, directToolNames, maxContextTokens, maxToolResultChars, dispatchSyntheticToolCall, chartRunRegistry, }: t.ToolNodeConstructorParams);
    /**
     * Returns cached programmatic tools, computing once on first access.
     * Single iteration builds both toolMap and toolDefs simultaneously.
     */
    private getProgrammaticTools;
    /**
     * Returns a snapshot of the current tool usage counts.
     * @returns A ReadonlyMap where keys are tool names and values are their usage counts.
     */
    getToolUsageCounts(): ReadonlyMap<string, number>;
    private resolveChartScope;
    private inferIncomingRole;
    /**
     * Trim charts[] before tool.invoke so max_charts / role dedupe apply to all
     * three paths (legacy, simple, server auto). Counts each chart individually.
     */
    private trimChartsForRegistry;
    private registerChartsFromToolOutput;
    /**
     * Runs a single tool call with error handling
     */
    protected runTool(call: ToolCall, config: RunnableConfig): Promise<BaseMessage | Command>;
    /**
     * Builds code session context for injection into event-driven tool calls.
     * Mirrors the session injection logic in runTool() for direct execution.
     */
    private getCodeSessionContext;
    /**
     * Extracts code execution session context from tool results and stores in Graph.sessions.
     * Mirrors the session storage logic in handleRunToolCompletions for direct execution.
     */
    private storeCodeSessionFromResults;
    /**
     * Post-processes standard runTool outputs: dispatches ON_RUN_STEP_COMPLETED
     * and stores code session context. Mirrors the completion handling in
     * dispatchToolEvents for the event-driven path.
     *
     * By handling completions here in graph context (rather than in the
     * stream consumer via ToolEndHandler), the race between the stream
     * consumer and graph execution is eliminated.
     */
    private handleRunToolCompletions;
    /**
     * Dispatches tool calls to the host via ON_TOOL_EXECUTE event and returns raw ToolMessages.
     * Core logic for event-driven execution, separated from output shaping.
     */
    private dispatchToolEvents;
    /**
     * Execute all tool calls via ON_TOOL_EXECUTE event dispatch.
     * Used in event-driven mode where the host handles actual tool execution.
     */
    private executeViaEvent;
    /**
     * After data-query tools succeed, deterministically generate charts by
     * synthesizing an echarts_generator_app tool call (no model decision).
     * Gated by agent.auto_chart + AUTO_CHART_PIPELINE_ENABLED.
     * Caps / role dedupe are enforced inside runTool via ChartRunRegistry.
     */
    private maybeInjectAutoCharts;
    protected run(input: any, config: RunnableConfig): Promise<T>;
    private isSendInput;
    private isMessagesState;
}
export declare function toolsCondition<T extends string>(state: BaseMessage[] | typeof MessagesAnnotation.State, toolNode: T, invokedToolIds?: Set<string>): T | typeof END;
