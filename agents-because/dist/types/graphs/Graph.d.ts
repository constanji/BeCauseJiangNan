import { ToolNode } from '@langchain/langgraph/prebuilt';
import { RunnableConfig } from '@langchain/core/runnables';
import type { UsageMetadata, BaseMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import type * as t from '@/types';
import { ToolNode as CustomToolNode } from '@/tools/ToolNode';
import { AgentContext } from '@/agents/AgentContext';
import { HandlerRegistry } from '@/events';
export declare abstract class Graph<T extends t.BaseGraphState = t.BaseGraphState, _TNodeName extends string = string> {
    abstract resetValues(): void;
    abstract initializeTools({ currentTools, currentToolMap, }: {
        currentTools?: t.GraphTools;
        currentToolMap?: t.ToolMap;
    }): CustomToolNode<T> | ToolNode<T>;
    abstract getRunMessages(): BaseMessage[] | undefined;
    abstract getContentParts(): t.MessageContentComplex[] | undefined;
    abstract generateStepId(stepKey: string): [string, number];
    abstract getKeyList(metadata: Record<string, unknown> | undefined): (string | number | undefined)[];
    abstract getStepKey(metadata: Record<string, unknown> | undefined): string;
    abstract checkKeyList(keyList: (string | number | undefined)[]): boolean;
    abstract getStepIdByKey(stepKey: string, index?: number): string;
    abstract getRunStep(stepId: string): t.RunStep | undefined;
    abstract dispatchRunStep(stepKey: string, stepDetails: t.StepDetails, metadata?: Record<string, unknown>): Promise<string>;
    abstract dispatchRunStepDelta(id: string, delta: t.ToolCallDelta): Promise<void>;
    abstract dispatchMessageDelta(id: string, delta: t.MessageDelta): Promise<void>;
    abstract dispatchReasoningDelta(stepId: string, delta: t.ReasoningDelta): Promise<void>;
    abstract createCallModel(agentId?: string, currentModel?: t.ChatModel): (state: t.AgentSubgraphState, config?: RunnableConfig) => Promise<Partial<t.AgentSubgraphState>>;
    messageStepHasToolCalls: Map<string, boolean>;
    messageIdsByStepKey: Map<string, string>;
    prelimMessageIdsByStepKey: Map<string, string>;
    config: RunnableConfig | undefined;
    contentData: t.RunStep[];
    stepKeyIds: Map<string, string[]>;
    contentIndexMap: Map<string, number>;
    toolCallStepIds: Map<string, string>;
    /**
     * Step IDs that have been dispatched via handler registry directly
     * (in dispatchRunStep).  Used by the custom event callback to skip
     * duplicate dispatch through the LangGraph callback chain.
     */
    handlerDispatchedStepIds: Set<string>;
    signal?: AbortSignal;
    /** Set of invoked tool call IDs from non-message run steps completed mid-run, if any */
    invokedToolIds?: Set<string>;
    handlerRegistry: HandlerRegistry | undefined;
    /**
     * Tool session contexts for automatic state persistence across tool invocations.
     * Keyed by tool name (e.g., Constants.EXECUTE_CODE).
     * Currently supports code execution session tracking (session_id, files).
     */
    sessions: t.ToolSessionMap;
    /**
     * Clears heavy references to allow GC to reclaim memory held by
     * LangGraph's internal config / AsyncLocalStorage RunTree chain.
     * Call after a run completes and content has been extracted.
     */
    clearHeavyState(): void;
}
export declare class StandardGraph extends Graph<t.BaseGraphState, t.GraphNode> {
    overrideModel?: t.ChatModel;
    /** Optional compile options passed into workflow.compile() */
    compileOptions?: t.CompileOptions | undefined;
    messages: BaseMessage[];
    /** Cached run messages preserved before clearHeavyState() so getRunMessages() works after cleanup. */
    private cachedRunMessages?;
    runId: string | undefined;
    /**
     * Boundary between historical messages (loaded from conversation state)
     * and messages produced during the current run.  Set once in the state
     * reducer when messages first arrive.  Used by `getRunMessages()` and
     * multi-agent message filtering — NOT for pruner token counting (the
     * pruner maintains its own `lastTurnStartIndex` in its closure).
     */
    startIndex: number;
    signal?: AbortSignal;
    /** Map of agent contexts by agent ID */
    agentContexts: Map<string, AgentContext>;
    /** Default agent ID to use */
    defaultAgentId: string;
    constructor({ runId, signal, agents, tokenCounter, indexTokenCountMap, calibrationRatio, }: t.StandardGraphInput);
    resetValues(keepContent?: boolean): void;
    clearHeavyState(): void;
    getRunStep(stepId: string): t.RunStep | undefined;
    getAgentContext(metadata: Record<string, unknown> | undefined): AgentContext;
    getStepKey(metadata: Record<string, unknown> | undefined): string;
    getStepIdByKey(stepKey: string, index?: number): string;
    generateStepId(stepKey: string): [string, number];
    getKeyList(metadata: Record<string, unknown> | undefined): (string | number | undefined)[];
    checkKeyList(keyList: (string | number | undefined)[]): boolean;
    getRunMessages(): BaseMessage[] | undefined;
    getContentParts(): t.MessageContentComplex[] | undefined;
    getCalibrationRatio(): number;
    getResolvedInstructionOverhead(): number | undefined;
    getToolCount(): number;
    /**
     * Get all run steps, optionally filtered by agent ID
     */
    getRunSteps(agentId?: string): t.RunStep[];
    /**
     * Get run steps grouped by agent ID
     */
    getRunStepsByAgent(): Map<string, t.RunStep[]>;
    /**
     * Get agent IDs that participated in this run
     */
    getActiveAgentIds(): string[];
    /**
     * Maps contentPart indices to agent IDs for post-run analysis
     * Returns a map where key is the contentPart index and value is the agentId
     */
    getContentPartAgentMap(): Map<number, string>;
    initializeTools({ currentTools, currentToolMap, agentContext, }: {
        currentTools?: t.GraphTools;
        currentToolMap?: t.ToolMap;
        agentContext?: AgentContext;
    }): CustomToolNode<t.BaseGraphState> | ToolNode<t.BaseGraphState>;
    /**
     * Register a synthetic tool call as a TOOL_CALLS run step so the UI stream
     * and toolCallStepIds map stay consistent with real LLM-initiated calls.
     */
    dispatchSyntheticToolCall(toolCall: ToolCall, config: RunnableConfig): Promise<string | undefined>;
    overrideTestModel(responses: string[], sleep?: number, toolCalls?: ToolCall[]): void;
    getUsageMetadata(finalMessage?: BaseMessage): Partial<UsageMetadata> | undefined;
    cleanupSignalListener(currentModel?: t.ChatModel): void;
    createCallModel(agentId?: string): (state: t.AgentSubgraphState, config?: RunnableConfig) => Promise<Partial<t.AgentSubgraphState>>;
    createAgentNode(agentId: string): t.CompiledAgentWorfklow;
    createWorkflow(): t.CompiledStateWorkflow;
    /**
     * Indicates if this is a multi-agent graph.
     * Override in MultiAgentGraph to return true.
     * Used to conditionally include agentId in RunStep for frontend rendering.
     */
    protected isMultiAgentGraph(): boolean;
    /**
     * Get the parallel group ID for an agent, if any.
     * Override in MultiAgentGraph to provide actual group IDs.
     * Group IDs are incrementing numbers (1, 2, 3...) reflecting execution order.
     * @param _agentId - The agent ID to look up
     * @returns undefined for StandardGraph (no parallel groups), or group number for MultiAgentGraph
     */
    protected getParallelGroupIdForAgent(_agentId: string): number | undefined;
    /**
     * Dispatches a run step to the client, returns the step ID
     */
    dispatchRunStep(stepKey: string, stepDetails: t.StepDetails, metadata?: Record<string, unknown>): Promise<string>;
    /**
     * Static version of handleToolCallError to avoid creating strong references
     * that prevent garbage collection
     */
    static handleToolCallErrorStatic(graph: StandardGraph, data: t.ToolErrorData, metadata?: Record<string, unknown>): Promise<void>;
    /**
     * Instance method that delegates to the static method
     * Kept for backward compatibility
     */
    handleToolCallError(data: t.ToolErrorData, metadata?: Record<string, unknown>): Promise<void>;
    dispatchRunStepDelta(id: string, delta: t.ToolCallDelta): Promise<void>;
    dispatchMessageDelta(id: string, delta: t.MessageDelta): Promise<void>;
    dispatchReasoningDelta: (stepId: string, delta: t.ReasoningDelta) => Promise<void>;
}
