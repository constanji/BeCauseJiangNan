import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { ToolCall } from '@langchain/core/messages/tool';
import {
  ToolMessage,
  isAIMessage,
  isBaseMessage,
} from '@langchain/core/messages';
import {
  END,
  Send,
  Command,
  isCommand,
  isGraphInterrupt,
  MessagesAnnotation,
} from '@langchain/langgraph';
import type {
  RunnableConfig,
  RunnableToolLike,
} from '@langchain/core/runnables';
import type { BaseMessage, AIMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type * as t from '@/types';
import { RunnableCallable } from '@/utils';
import {
  calculateMaxToolResultChars,
  truncateToolResultContent,
} from '@/utils/truncation';
import {
  buildAutoCharts,
  extractTableFromToolOutput,
  isAutoChartPipelineGloballyEnabled,
  isAutoChartTriggerTool,
  matchAutoChartData,
} from '@/utils/autoChartFromRows';
import { buildIndicatorCharts } from '@/utils/autoChartRules/indicator';
import { buildAttributionCharts } from '@/utils/autoChartRules/attribution';
import type { ChartRole, ChartRunRegistry } from '@/tools/ChartRunRegistry';
import type { SimpleChartSpec } from '@/utils/autoChartRules/types';
import type { ChartMatchRules } from '@/utils/autoChartRules/types';
import { normalizeAutoChartUnits } from '@/utils/autoChartUnits';
import { safeDispatchCustomEvent } from '@/utils/events';
import { Constants, GraphEvents } from '@/common';

const ECHARTS_TOOL_NAME = 'echarts_generator_app';
const DEFAULT_MAX_CHARTS = 2;

function isAutoChartDataCall(call: ToolCall): boolean {
  if (call.name === 'because_jn') {
    const args = call.args as Record<string, unknown> | undefined;
    return args?.command === 'sql-executor';
  }
  return /^ask_data(_mcp_.+)?$/i.test(call.name);
}

function isExplicitDataFailure(call: ToolCall, content: string): boolean {
  if (call.name !== 'because_jn') {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as { success?: boolean };
    return parsed?.success === false;
  } catch {
    return false;
  }
}

function safeConversationToken(value: unknown): string {
  const input = String(value || '').trim();
  if (!input) return '';
  // Keep the token protocol-safe: chartIdSequence scans hexadecimal tokens,
  // while base64url may contain '_' and '-'.
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function safeChartPrefix(value: unknown, fallback: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return normalized || fallback;
}

function chartTypeHint(chart: Record<string, unknown>): string | undefined {
  const normalize = (value: unknown): string | undefined => {
    const type = String(value || '').trim().toLowerCase();
    return ['line', 'bar', 'pie'].includes(type) ? type : undefined;
  };
  const direct = normalize(chart.type);
  if (direct) return direct;
  const option = chart.echartsOption as Record<string, unknown> | undefined;
  const series = Array.isArray(option?.series) ? option.series[0] : undefined;
  if (series && typeof series === 'object' && typeof (series as Record<string, unknown>).type === 'string') {
    return normalize((series as Record<string, unknown>).type);
  }
  const spec = chart.g2Spec as Record<string, unknown> | undefined;
  const specType = normalize(spec?.type);
  if (specType) return specType;
  return undefined;
}

/**
 * Helper to check if a value is a Send object
 */
function isSend(value: unknown): value is Send {
  return value instanceof Send;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ToolNode<T = any> extends RunnableCallable<T, T> {
  private toolMap: Map<string, StructuredToolInterface | RunnableToolLike>;
  private loadRuntimeTools?: t.ToolRefGenerator;
  handleToolErrors = true;
  trace = false;
  toolCallStepIds?: Map<string, string>;
  errorHandler?: t.ToolNodeConstructorParams['errorHandler'];
  private toolUsageCount: Map<string, number>;
  /** Maps toolCallId → turn captured in runTool, used by handleRunToolCompletions */
  private toolCallTurns: Map<string, number> = new Map();
  /** Tool registry for filtering (lazy computation of programmatic maps) */
  private toolRegistry?: t.LCToolRegistry;
  /** Cached programmatic tools (computed once on first PTC call) */
  private programmaticCache?: t.ProgrammaticCache;
  /** Reference to Graph's sessions map for automatic session injection */
  private sessions?: t.ToolSessionMap;
  /** When true, dispatches ON_TOOL_EXECUTE events instead of invoking tools directly */
  private eventDrivenMode: boolean = false;
  /** Agent ID for event-driven mode */
  private agentId?: string;
  /** Tool names that bypass event dispatch and execute directly (e.g., graph-managed handoff tools) */
  private directToolNames?: Set<string>;
  /** Maximum characters allowed in a single tool result before truncation. */
  private maxToolResultChars: number;
  /** Optional callback to register synthetic tool calls in the UI stream */
  private dispatchSyntheticToolCall?: t.ToolNodeOptions['dispatchSyntheticToolCall'];
  /** Graph-owned per-run chart registry */
  private chartRunRegistry?: ChartRunRegistry;

  constructor({
    tools,
    toolMap,
    name,
    tags,
    errorHandler,
    toolCallStepIds,
    handleToolErrors,
    loadRuntimeTools,
    toolRegistry,
    toolDefinitions,
    sessions,
    eventDrivenMode,
    agentId,
    directToolNames,
    maxContextTokens,
    maxToolResultChars,
    dispatchSyntheticToolCall,
    chartRunRegistry,
  }: t.ToolNodeConstructorParams) {
    super({ name, tags, func: (input, config) => this.run(input, config) });
    this.toolMap = toolMap ?? new Map(tools.map((tool) => [tool.name, tool]));
    this.toolCallStepIds = toolCallStepIds;
    this.handleToolErrors = handleToolErrors ?? this.handleToolErrors;
    this.loadRuntimeTools = loadRuntimeTools;
    this.errorHandler = errorHandler;
    this.toolUsageCount = new Map<string, number>();
    if (toolDefinitions != null && toolDefinitions.size > 0) {
      const merged = new Map(toolRegistry ?? []);
      for (const [k, v] of toolDefinitions) {
        merged.set(k, v);
      }
      this.toolRegistry = merged;
    } else {
      this.toolRegistry = toolRegistry;
    }
    this.sessions = sessions;
    this.eventDrivenMode = eventDrivenMode ?? false;
    this.agentId = agentId;
    this.directToolNames = directToolNames;
    this.maxToolResultChars =
      maxToolResultChars ?? calculateMaxToolResultChars(maxContextTokens);
    this.dispatchSyntheticToolCall = dispatchSyntheticToolCall;
    this.chartRunRegistry = chartRunRegistry;
  }

  /**
   * Returns cached programmatic tools, computing once on first access.
   * Single iteration builds both toolMap and toolDefs simultaneously.
   */
  private getProgrammaticTools(): { toolMap: t.ToolMap; toolDefs: t.LCTool[] } {
    if (this.programmaticCache) return this.programmaticCache;

    const toolMap: t.ToolMap = new Map();
    const toolDefs: t.LCTool[] = [];

    if (this.toolRegistry) {
      for (const [name, toolDef] of this.toolRegistry) {
        if (
          (toolDef.allowed_callers ?? ['direct']).includes('code_execution')
        ) {
          toolDefs.push(toolDef);
          const tool = this.toolMap.get(name);
          if (tool) toolMap.set(name, tool);
        }
      }
    }

    this.programmaticCache = { toolMap, toolDefs };
    return this.programmaticCache;
  }

  /**
   * Returns a snapshot of the current tool usage counts.
   * @returns A ReadonlyMap where keys are tool names and values are their usage counts.
   */
  public getToolUsageCounts(): ReadonlyMap<string, number> {
    return new Map(this.toolUsageCount); // Return a copy
  }

  private resolveChartScope(
    config: RunnableConfig,
    callId?: string
  ): {
    agentId: string;
    stepId: string;
    maxCharts: number;
    dedupeRoles: boolean;
  } {
    const agentId =
      this.agentId ||
      (typeof config.metadata?.agent_id === 'string'
        ? config.metadata.agent_id
        : 'default');
    // Turn-scoped key: registry is cleared each processStream, so 'current'
    // isolates agents without requiring the message step id at tool time.
    const stepId = 'current';
    const chartConfig = config.configurable?.chart_config as
      | { max_charts?: number; dedupe_roles?: boolean }
      | undefined;
    const maxCharts =
      typeof chartConfig?.max_charts === 'number' && chartConfig.max_charts >= 1
        ? chartConfig.max_charts
        : DEFAULT_MAX_CHARTS;
    const dedupeRoles = chartConfig?.dedupe_roles !== false;
    return { agentId, stepId, maxCharts, dedupeRoles };
  }

  private inferIncomingRole(item: Record<string, unknown>): ChartRole {
    if (
      item.role === 'indicator' ||
      item.role === 'contribution' ||
      item.role === 'drag' ||
      item.role === 'general'
    ) {
      return item.role;
    }
    const title = typeof item.title === 'string' ? item.title : '';
    if (/贡献/.test(title)) {
      return 'contribution';
    }
    if (/拖累/.test(title)) {
      return 'drag';
    }
    const analysisType =
      typeof item.analysisType === 'string' ? item.analysisType : '';
    if (
      analysisType === 'trend_analysis' ||
      analysisType === 'dimension_compare' ||
      analysisType === 'combined_analysis'
    ) {
      return 'indicator';
    }
    return 'general';
  }

  /**
   * Trim charts[] before tool.invoke so max_charts / role dedupe apply to all
   * three paths (legacy, simple, server auto). Counts each chart individually.
   */
  private trimChartsForRegistry(
    charts: unknown[],
    config: RunnableConfig,
    callId?: string
  ): { charts: unknown[]; rejected: boolean; reason?: string } {
    if (!this.chartRunRegistry || !Array.isArray(charts)) {
      return { charts, rejected: false };
    }
    const { agentId, stepId, maxCharts, dedupeRoles } = this.resolveChartScope(
      config,
      callId
    );
    const remaining =
      maxCharts - this.chartRunRegistry.countThisTurn(agentId, stepId);
    if (remaining <= 0) {
      return {
        charts: [],
        rejected: true,
        reason: `已达本轮图表上限（max_charts=${maxCharts}）`,
      };
    }

    const kept: unknown[] = [];
    for (const raw of charts) {
      if (kept.length >= remaining) {
        break;
      }
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const item = raw as Record<string, unknown>;
      const role = this.inferIncomingRole(item);
      // A successful server-generated chart owns this role for the turn. This
      // prevents the model from emitting a second chart for the same result
      // after Auto already rendered one.
      if (
        dedupeRoles &&
        this.chartRunRegistry.hasSource(agentId, stepId, 'server_auto') &&
        role !== 'general' &&
        this.chartRunRegistry.hasRole(agentId, stepId, role)
      ) {
        continue;
      }
      // Deduplicate non-general roles across batches
      if (
        dedupeRoles &&
        role !== 'general' &&
        this.chartRunRegistry.hasRole(agentId, stepId, role)
      ) {
        continue;
      }
      // Also skip if this batch already kept the same role
      if (
        dedupeRoles &&
        role !== 'general' &&
        kept.some(
          (k) =>
            k &&
            typeof k === 'object' &&
            this.inferIncomingRole(k as Record<string, unknown>) === role
        )
      ) {
        continue;
      }
      kept.push(item);
    }
    return { charts: kept, rejected: kept.length === 0 && charts.length > 0 };
  }

  private registerChartsFromToolOutput(
    content: string,
    config: RunnableConfig,
    callId: string | undefined,
    source: 'model_legacy' | 'model_simple' | 'server_auto'
  ): string {
    if (!this.chartRunRegistry) {
      return content;
    }
    try {
      const parsed = JSON.parse(content) as {
        success?: boolean;
        charts?: Array<Record<string, unknown>>;
      };
      if (parsed?.success !== true || !Array.isArray(parsed.charts)) {
        return content;
      }
      const { agentId, stepId } = this.resolveChartScope(config, callId);
      let changed = false;
      for (const chart of parsed.charts) {
        const requestedId =
          typeof chart.id === 'string' && chart.id ? chart.id : nanoid();
        const role = this.inferIncomingRole(chart);
        const finalId = this.chartRunRegistry.register(agentId, stepId, {
          chartId: requestedId,
          role,
          source,
          toolCallId: callId,
          title: typeof chart.title === 'string' ? chart.title : undefined,
          typeHint: chartTypeHint(chart),
        });
        if (finalId !== chart.id) {
          chart.id = finalId;
          changed = true;
        }
      }
      return changed ? JSON.stringify(parsed, null, 2) : content;
    } catch {
      return content;
    }
  }

  /**
   * Runs a single tool call with error handling
   */
  protected async runTool(
    call: ToolCall,
    config: RunnableConfig
  ): Promise<BaseMessage | Command> {
    const tool = this.toolMap.get(call.name);
    try {
      if (tool === undefined) {
        throw new Error(`Tool "${call.name}" not found.`);
      }
      const turn = this.toolUsageCount.get(call.name) ?? 0;
      this.toolUsageCount.set(call.name, turn + 1);
      if (call.id != null && call.id !== '') {
        this.toolCallTurns.set(call.id, turn);
      }
      let args = call.args;
      const stepId = this.toolCallStepIds?.get(call.id!);

      // Pre-invoke chart cap / role dedupe (all three generation paths)
      if (
        call.name === ECHARTS_TOOL_NAME &&
        args != null &&
        typeof args === 'object' &&
        Array.isArray((args as { charts?: unknown }).charts)
      ) {
        const trimmed = this.trimChartsForRegistry(
          (args as { charts: unknown[] }).charts,
          config,
          call.id
        );
        if (trimmed.rejected && trimmed.charts.length === 0) {
          return new ToolMessage({
            status: 'success',
            name: ECHARTS_TOOL_NAME,
            content: JSON.stringify(
              {
                success: false,
                error: trimmed.reason || '已达本轮图表上限，跳过本次调用',
                skipped: true,
              },
              null,
              2
            ),
            tool_call_id: call.id ?? '',
          });
        }
        args = { ...args, charts: trimmed.charts };
      }

      // Build invoke params - LangChain extracts non-schema fields to config.toolCall
      let invokeParams: Record<string, unknown> = {
        ...call,
        args,
        type: 'tool_call',
        stepId,
        turn,
      };

      // Inject runtime data for special tools (becomes available at config.toolCall)
      if (call.name === Constants.PROGRAMMATIC_TOOL_CALLING) {
        const { toolMap, toolDefs } = this.getProgrammaticTools();
        invokeParams = {
          ...invokeParams,
          toolMap,
          toolDefs,
        };
      } else if (call.name === Constants.TOOL_SEARCH) {
        invokeParams = {
          ...invokeParams,
          toolRegistry: this.toolRegistry,
        };
      }

      /**
       * Inject session context for code execution tools when available.
       * Each file uses its own session_id (supporting multi-session file tracking).
       * Both session_id and _injected_files are injected directly to invokeParams
       * (not inside args) so they bypass Zod schema validation and reach config.toolCall.
       *
       * session_id is always injected when available (even without tracked files)
       * so the CodeExecutor can fall back to the /files endpoint for session continuity.
       */
      if (
        call.name === Constants.EXECUTE_CODE ||
        call.name === Constants.PROGRAMMATIC_TOOL_CALLING
      ) {
        const codeSession = this.sessions?.get(Constants.EXECUTE_CODE) as
          | t.CodeSessionContext
          | undefined;
        if (codeSession?.session_id != null && codeSession.session_id !== '') {
          invokeParams = {
            ...invokeParams,
            session_id: codeSession.session_id,
          };

          if (codeSession.files != null && codeSession.files.length > 0) {
            const fileRefs: t.CodeEnvFile[] = codeSession.files.map(
              (file: t.CodeEnvFile) => ({
                session_id: file.session_id ?? codeSession.session_id,
                id: file.id,
                name: file.name,
              })
            );
            invokeParams._injected_files = fileRefs;
          }
        }
      }

      const output = await tool.invoke(invokeParams, config);
      if (
        (isBaseMessage(output) && output._getType() === 'tool') ||
        isCommand(output)
      ) {
        if (
          call.name === ECHARTS_TOOL_NAME &&
          isBaseMessage(output) &&
          typeof (output as ToolMessage).content === 'string'
        ) {
          const toolMsg = output as ToolMessage;
          const source =
            (call.args as { _autoGenerated?: boolean } | undefined)
              ?._autoGenerated === true
              ? 'server_auto'
              : Array.isArray(
                    (
                      call.args as {
                        charts?: Array<{ echartsOption?: unknown }>;
                      }
                    )?.charts
                  ) &&
                  (
                    call.args as { charts: Array<{ echartsOption?: unknown }> }
                  ).charts.some((c) => c && c.echartsOption != null)
                ? 'model_legacy'
                : 'model_simple';
          const rewritten = this.registerChartsFromToolOutput(
            toolMsg.content as string,
            config,
            call.id,
            source
          );
          if (rewritten !== toolMsg.content) {
            return new ToolMessage({
              status: toolMsg.status ?? 'success',
              name: toolMsg.name ?? tool.name,
              content: truncateToolResultContent(
                rewritten,
                this.maxToolResultChars
              ),
              tool_call_id: call.id!,
            });
          }
        }
        return output;
      } else {
        let rawContent =
          typeof output === 'string' ? output : JSON.stringify(output);
        if (call.name === ECHARTS_TOOL_NAME) {
          const source =
            (call.args as { _autoGenerated?: boolean } | undefined)
              ?._autoGenerated === true
              ? 'server_auto'
              : 'model_simple';
          rawContent = this.registerChartsFromToolOutput(
            rawContent,
            config,
            call.id,
            source
          );
        }
        return new ToolMessage({
          status: 'success',
          name: tool.name,
          content: truncateToolResultContent(
            rawContent,
            this.maxToolResultChars
          ),
          tool_call_id: call.id!,
        });
      }
    } catch (_e: unknown) {
      const e = _e as Error;
      if (!this.handleToolErrors) {
        throw e;
      }
      if (isGraphInterrupt(e)) {
        throw e;
      }
      if (this.errorHandler) {
        try {
          await this.errorHandler(
            {
              error: e,
              id: call.id!,
              name: call.name,
              input: call.args,
            },
            config.metadata
          );
        } catch (handlerError) {
          // eslint-disable-next-line no-console
          console.error('Error in errorHandler:', {
            toolName: call.name,
            toolCallId: call.id,
            toolArgs: call.args,
            stepId: this.toolCallStepIds?.get(call.id!),
            turn: this.toolUsageCount.get(call.name),
            originalError: {
              message: e.message,
              stack: e.stack ?? undefined,
            },
            handlerError:
              handlerError instanceof Error
                ? {
                    message: handlerError.message,
                    stack: handlerError.stack ?? undefined,
                  }
                : {
                    message: String(handlerError),
                    stack: undefined,
                  },
          });
        }
      }
      return new ToolMessage({
        status: 'error',
        content: `Error: ${e.message}\n Please fix your mistakes.`,
        name: call.name,
        tool_call_id: call.id ?? '',
      });
    }
  }

  /**
   * Builds code session context for injection into event-driven tool calls.
   * Mirrors the session injection logic in runTool() for direct execution.
   */
  private getCodeSessionContext(): t.ToolCallRequest['codeSessionContext'] {
    if (!this.sessions) {
      return undefined;
    }

    const codeSession = this.sessions.get(Constants.EXECUTE_CODE) as
      | t.CodeSessionContext
      | undefined;
    if (!codeSession) {
      return undefined;
    }

    const context: NonNullable<t.ToolCallRequest['codeSessionContext']> = {
      session_id: codeSession.session_id,
    };

    if (codeSession.files && codeSession.files.length > 0) {
      context.files = codeSession.files.map((file: t.CodeEnvFile) => ({
        session_id: file.session_id ?? codeSession.session_id,
        id: file.id,
        name: file.name,
      }));
    }

    return context;
  }

  /**
   * Extracts code execution session context from tool results and stores in Graph.sessions.
   * Mirrors the session storage logic in handleRunToolCompletions for direct execution.
   */
  private storeCodeSessionFromResults(
    results: t.ToolExecuteResult[],
    requests: t.ToolCallRequest[]
  ): void {
    if (!this.sessions) {
      return;
    }

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'success' || result.artifact == null) {
        continue;
      }

      const request = requests.find((r) => r.id === result.toolCallId);
      if (
        request?.name !== Constants.EXECUTE_CODE &&
        request?.name !== Constants.PROGRAMMATIC_TOOL_CALLING
      ) {
        continue;
      }

      const artifact = result.artifact as t.CodeExecutionArtifact | undefined;
      if (artifact?.session_id == null || artifact.session_id === '') {
        continue;
      }

      const newFiles = artifact.files ?? [];
      const existingSession = this.sessions.get(Constants.EXECUTE_CODE) as
        | t.CodeSessionContext
        | undefined;
      const existingFiles = existingSession?.files ?? [];

      if (newFiles.length > 0) {
        const filesWithSession: t.FileRefs = newFiles.map(
          (file: t.FileRef) => ({
            ...file,
            session_id: artifact.session_id,
          })
        );

        const newFileNames = new Set(filesWithSession.map((f) => f.name));
        const filteredExisting = existingFiles.filter(
          (f: t.CodeEnvFile) => !newFileNames.has(f.name)
        );

        this.sessions.set(Constants.EXECUTE_CODE, {
          session_id: artifact.session_id,
          files: [...filteredExisting, ...filesWithSession],
          lastUpdated: Date.now(),
        });
      } else {
        this.sessions.set(Constants.EXECUTE_CODE, {
          session_id: artifact.session_id,
          files: existingFiles,
          lastUpdated: Date.now(),
        });
      }
    }
  }

  /**
   * Post-processes standard runTool outputs: dispatches ON_RUN_STEP_COMPLETED
   * and stores code session context. Mirrors the completion handling in
   * dispatchToolEvents for the event-driven path.
   *
   * By handling completions here in graph context (rather than in the
   * stream consumer via ToolEndHandler), the race between the stream
   * consumer and graph execution is eliminated.
   */
  private handleRunToolCompletions(
    calls: ToolCall[],
    outputs: (BaseMessage | Command)[],
    config: RunnableConfig
  ): void {
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const output = outputs[i];
      const turn = this.toolCallTurns.get(call.id!) ?? 0;

      if (isCommand(output)) {
        continue;
      }

      const toolMessage = output as ToolMessage;
      const toolCallId = call.id ?? '';

      // Skip error ToolMessages when errorHandler already dispatched ON_RUN_STEP_COMPLETED
      // via handleToolCallErrorStatic. Without this check, errors would be double-dispatched.
      if (toolMessage.status === 'error' && this.errorHandler != null) {
        continue;
      }

      // Store code session context from tool results
      if (
        this.sessions &&
        (call.name === Constants.EXECUTE_CODE ||
          call.name === Constants.PROGRAMMATIC_TOOL_CALLING)
      ) {
        const artifact = toolMessage.artifact as
          | t.CodeExecutionArtifact
          | undefined;
        if (artifact?.session_id != null && artifact.session_id !== '') {
          const newFiles = artifact.files ?? [];
          const existingSession = this.sessions.get(Constants.EXECUTE_CODE) as
            | t.CodeSessionContext
            | undefined;
          const existingFiles = existingSession?.files ?? [];

          if (newFiles.length > 0) {
            const filesWithSession: t.FileRefs = newFiles.map(
              (file: t.FileRef) => ({
                ...file,
                session_id: artifact.session_id,
              })
            );
            const newFileNames = new Set(filesWithSession.map((f) => f.name));
            const filteredExisting = existingFiles.filter(
              (f: t.CodeEnvFile) => !newFileNames.has(f.name)
            );
            this.sessions.set(Constants.EXECUTE_CODE, {
              session_id: artifact.session_id,
              files: [...filteredExisting, ...filesWithSession],
              lastUpdated: Date.now(),
            });
          } else {
            this.sessions.set(Constants.EXECUTE_CODE, {
              session_id: artifact.session_id,
              files: existingFiles,
              lastUpdated: Date.now(),
            });
          }
        }
      }

      // Dispatch ON_RUN_STEP_COMPLETED via custom event (same path as dispatchToolEvents)
      const stepId = this.toolCallStepIds?.get(toolCallId) ?? '';
      if (!stepId) {
        continue;
      }

      const contentString =
        typeof toolMessage.content === 'string'
          ? toolMessage.content
          : JSON.stringify(toolMessage.content);

      const tool_call: t.ProcessedToolCall = {
        args:
          typeof call.args === 'string'
            ? (call.args as string)
            : JSON.stringify((call.args as unknown) ?? {}),
        name: call.name,
        id: toolCallId,
        output: contentString,
        progress: 1,
      };

      safeDispatchCustomEvent(
        GraphEvents.ON_RUN_STEP_COMPLETED,
        {
          result: {
            id: stepId,
            index: turn,
            type: 'tool_call' as const,
            tool_call,
          },
        },
        config
      );
    }
  }

  /**
   * Dispatches tool calls to the host via ON_TOOL_EXECUTE event and returns raw ToolMessages.
   * Core logic for event-driven execution, separated from output shaping.
   */
  private async dispatchToolEvents(
    toolCalls: ToolCall[],
    config: RunnableConfig
  ): Promise<ToolMessage[]> {
    const skippedById = new Map<string, ToolMessage>();
    const callsToDispatch: ToolCall[] = [];
    for (const call of toolCalls) {
      if (
        call.name !== ECHARTS_TOOL_NAME ||
        !call.args ||
        typeof call.args !== 'object' ||
        !Array.isArray((call.args as { charts?: unknown }).charts)
      ) {
        callsToDispatch.push(call);
        continue;
      }
      const trimmed = this.trimChartsForRegistry(
        (call.args as { charts: unknown[] }).charts,
        config,
        call.id
      );
      if (trimmed.rejected && trimmed.charts.length === 0) {
        const skipped = new ToolMessage({
          status: 'success',
          name: ECHARTS_TOOL_NAME,
          content: JSON.stringify({
            success: false,
            skipped: true,
            error: trimmed.reason || '已达本轮图表上限，跳过本次调用',
          }),
          tool_call_id: call.id ?? '',
        });
        skippedById.set(call.id ?? '', skipped);
        this.handleRunToolCompletions([call], [skipped], config);
        continue;
      }
      callsToDispatch.push({
        ...call,
        args: {
          ...(call.args as Record<string, unknown>),
          charts: trimmed.charts,
        },
      });
    }

    const requests: t.ToolCallRequest[] = callsToDispatch.map((call) => {
      const turn = this.toolUsageCount.get(call.name) ?? 0;
      this.toolUsageCount.set(call.name, turn + 1);

      const request: t.ToolCallRequest = {
        id: call.id!,
        name: call.name,
        args: call.args as Record<string, unknown>,
        stepId: this.toolCallStepIds?.get(call.id!),
        turn,
      };

      if (
        call.name === Constants.EXECUTE_CODE ||
        call.name === Constants.PROGRAMMATIC_TOOL_CALLING
      ) {
        request.codeSessionContext = this.getCodeSessionContext();
      }

      return request;
    });

    const results =
      requests.length > 0
        ? await new Promise<t.ToolExecuteResult[]>((resolve, reject) => {
            const request: t.ToolExecuteBatchRequest = {
              toolCalls: requests,
              userId: config.configurable?.user_id as string | undefined,
              agentId: this.agentId,
              configurable: config.configurable as
                | Record<string, unknown>
                | undefined,
              metadata: config.metadata as Record<string, unknown> | undefined,
              resolve,
              reject,
            };

            safeDispatchCustomEvent(
              GraphEvents.ON_TOOL_EXECUTE,
              request,
              config
            );
          })
        : [];

    this.storeCodeSessionFromResults(results, requests);

    const completedById = new Map<string, ToolMessage>();
    results.forEach((result) => {
      const request = requests.find((r) => r.id === result.toolCallId);
      const toolName = request?.name ?? 'unknown';
      const stepId = this.toolCallStepIds?.get(result.toolCallId) ?? '';
      if (!stepId) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ToolNode] toolCallStepIds missing entry for toolCallId=${result.toolCallId} (tool=${toolName}). ` +
            'This indicates a race between the stream consumer and graph execution. ' +
            `Map size: ${this.toolCallStepIds?.size ?? 0}`
        );
      }

      let toolMessage: ToolMessage;
      let contentString: string;

      if (result.status === 'error') {
        contentString = `Error: ${result.errorMessage ?? 'Unknown error'}\n Please fix your mistakes.`;
        toolMessage = new ToolMessage({
          status: 'error',
          content: contentString,
          name: toolName,
          tool_call_id: result.toolCallId,
        });
      } else {
        const rawContent =
          typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content);
        let registeredContent = rawContent;
        if (toolName === ECHARTS_TOOL_NAME) {
          const requestArgs = request?.args as
            | {
                _autoGenerated?: boolean;
                charts?: Array<{ echartsOption?: unknown }>;
              }
            | undefined;
          const source =
            requestArgs?._autoGenerated === true
              ? 'server_auto'
              : requestArgs?.charts?.some((chart) => chart?.echartsOption != null)
                ? 'model_legacy'
                : 'model_simple';
          registeredContent = this.registerChartsFromToolOutput(
            rawContent,
            config,
            result.toolCallId,
            source,
          );
        }
        contentString = truncateToolResultContent(
          registeredContent,
          this.maxToolResultChars
        );
        toolMessage = new ToolMessage({
          status: 'success',
          name: toolName,
          content: contentString,
          artifact: result.artifact,
          tool_call_id: result.toolCallId,
        });
      }

      const tool_call: t.ProcessedToolCall = {
        args:
          typeof request?.args === 'string'
            ? request.args
            : JSON.stringify(request?.args ?? {}),
        name: toolName,
        id: result.toolCallId,
        output: contentString,
        progress: 1,
      };

      const runStepCompletedData = {
        result: {
          id: stepId,
          index: request?.turn ?? 0,
          type: 'tool_call' as const,
          tool_call,
        },
      };

      safeDispatchCustomEvent(
        GraphEvents.ON_RUN_STEP_COMPLETED,
        runStepCompletedData,
        config
      );

      completedById.set(result.toolCallId, toolMessage);
    });

    return toolCalls.map((call) => {
      const output =
        skippedById.get(call.id ?? '') ?? completedById.get(call.id ?? '');
      if (!output) {
        throw new Error(
          `[ToolNode] No event output found for tool_call_id=${call.id} (tool=${call.name}).`
        );
      }
      return output;
    });
  }

  /**
   * Execute all tool calls via ON_TOOL_EXECUTE event dispatch.
   * Used in event-driven mode where the host handles actual tool execution.
   */
  private async executeViaEvent(
    toolCalls: ToolCall[],
    config: RunnableConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any
  ): Promise<T> {
    const outputs = await this.dispatchToolEvents(toolCalls, config);
    const withCharts = await this.maybeInjectAutoCharts(
      toolCalls,
      outputs,
      config
    );
    return (Array.isArray(input) ? withCharts : { messages: withCharts }) as T;
  }

  /**
   * After data-query tools succeed, deterministically generate charts by
   * synthesizing an echarts_generator_app tool call (no model decision).
   * Gated by agent.auto_chart + AUTO_CHART_PIPELINE_ENABLED.
   * Caps / role dedupe are enforced inside runTool via ChartRunRegistry.
   */
  private async maybeInjectAutoCharts(
    calls: ToolCall[],
    outputs: (BaseMessage | Command)[],
    config: RunnableConfig
  ): Promise<(BaseMessage | Command)[]> {
    try {
      if (!isAutoChartPipelineGloballyEnabled()) {
        return outputs;
      }
      if (config.configurable?.auto_chart !== true) {
        return outputs;
      }
      if (!this.dispatchSyntheticToolCall) {
        return outputs;
      }

      const echartsTool = this.toolMap.get(ECHARTS_TOOL_NAME);
      if (!echartsTool) {
        return outputs;
      }

      // Model already requested a chart in this batch — do not double-inject
      if (calls.some((c) => c.name === ECHARTS_TOOL_NAME)) {
        return outputs;
      }

      const chartConfig = (config.configurable?.chart_config ?? undefined) as
        | {
            preset?: 'indicator' | 'attribution' | 'custom';
            input_mode?: 'simple' | 'legacy';
            max_charts?: number;
            dedupe_roles?: boolean;
            marker?: string;
            match_rules?: ChartMatchRules;
          }
        | undefined;

      const userQuestion =
        typeof config.configurable?.requestBody?.text === 'string'
          ? config.configurable.requestBody.text
          : undefined;

      const extraCalls: ToolCall[] = [];
      const extraOutputs: ToolMessage[] = [];

      // Pull fluctuation-attribution args if present in this batch. Two real
      // call shapes exist:
      // 1. Standalone tool `fluctuation_attribution` (underscore) — args has
      //    base_data/current_data directly as arrays (see
      //    FluctuationAttributionTool.js schema).
      // 2. `because_jn` skills wrapper — args is
      //    `{ command: 'fluctuation-attribution' (hyphen), arguments: '<JSON string>' }`,
      //    where the JSON string (not the outer args object) carries
      //    base_data/current_data (see BeCauseSkillsJN.js).
      let attrBase: Record<string, unknown>[] | undefined;
      let attrCurrent: Record<string, unknown>[] | undefined;
      for (const c of calls) {
        const rawArgs = (c.args ?? {}) as Record<string, unknown>;
        let attrArgs: Record<string, unknown> | undefined;

        if (c.name === 'fluctuation_attribution') {
          attrArgs = rawArgs;
        } else if (
          c.name === 'because_jn' &&
          rawArgs.command === 'fluctuation-attribution'
        ) {
          const argumentsStr = rawArgs.arguments;
          if (typeof argumentsStr === 'string' && argumentsStr.trim()) {
            try {
              const parsed = JSON.parse(argumentsStr);
              if (parsed && typeof parsed === 'object') {
                attrArgs = parsed as Record<string, unknown>;
              }
            } catch {
              // Malformed JSON string — fall through, leaves attrArgs undefined
              // so callers fall back to sql-executor rows.
            }
          }
        }

        if (!attrArgs) {
          continue;
        }
        if (Array.isArray(attrArgs.base_data)) {
          attrBase = attrArgs.base_data as Record<string, unknown>[];
        }
        if (Array.isArray(attrArgs.current_data)) {
          attrCurrent = attrArgs.current_data as Record<string, unknown>[];
        }
      }

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const output = outputs[i];
        if (!call || output == null || isCommand(output)) {
          continue;
        }
        if (!isAutoChartTriggerTool(call.name) || !isAutoChartDataCall(call)) {
          continue;
        }

        const toolMessage = output as ToolMessage;
        if (toolMessage.status === 'error') {
          continue;
        }

        const contentString =
          typeof toolMessage.content === 'string'
            ? toolMessage.content
            : JSON.stringify(toolMessage.content);

        const args =
          call.args != null && typeof call.args === 'object'
            ? (call.args as Record<string, unknown>)
            : {};

        if (isExplicitDataFailure(call, contentString)) {
          continue;
        }

        const table = extractTableFromToolOutput(
          call.name,
          args,
          contentString
        );
        if (!table) {
          continue;
        }

        const prefix = `auto_${call.id || nanoid()}`;
        const maxCharts = chartConfig?.max_charts ?? DEFAULT_MAX_CHARTS;
        const preset = chartConfig?.preset ?? 'custom';
        const useSimple = chartConfig?.input_mode === 'simple';

        if (preset !== 'attribution') {
          const decision = matchAutoChartData(
            table.rows,
            table.columns,
            userQuestion,
            chartConfig?.match_rules,
          );
          if (decision.status === 'disabled') {
            continue;
          }
          if (decision.status === 'no_match') {
            continue;
          }
        }

        let charts: unknown[] | null = null;

        if (useSimple) {
          let specs: SimpleChartSpec[] = [];
          if (preset === 'indicator') {
            specs = buildIndicatorCharts(table.rows, {
              columns: table.columns,
              userQuestion,
              maxCharts,
              chartIdPrefix: prefix,
              matchRules: chartConfig?.match_rules,
            });
          } else if (preset === 'attribution') {
            specs = buildAttributionCharts({
              rows: table.rows,
              columns: table.columns,
              base_data: attrBase,
              current_data: attrCurrent,
              userQuestion,
              maxCharts,
              chartIdPrefix: prefix,
            });
          } else {
            // custom: generic chartability, role=general
            const legacy = buildAutoCharts(
              table.rows,
              table.columns,
              `${prefix}_0`,
              userQuestion,
              chartConfig?.match_rules,
            );
            if (legacy && legacy.length > 0) {
              // Convert legacy echartsOption charts to simple when possible is complex;
              // for custom+simple, emit a general simple bar/line via indicator builder first,
              // fall back to wrapping legacy as echartsOption items if needed.
              const ind = buildIndicatorCharts(table.rows, {
                columns: table.columns,
                userQuestion,
                maxCharts,
                chartIdPrefix: prefix,
                matchRules: chartConfig?.match_rules,
              });
              if (ind.length > 0) {
                specs = ind.map((s) => ({ ...s, role: 'general' as const }));
              } else {
                charts = legacy.map((c) => ({
                  ...c,
                  role: 'general',
                }));
              }
            }
          }
          if (!charts && specs.length > 0) {
            charts = specs;
          }
        } else {
          // legacy protocol: full echartsOption
          const legacy = buildAutoCharts(
            table.rows,
            table.columns,
            `${prefix}_0`,
            userQuestion,
            chartConfig?.match_rules,
          );
          charts = legacy;
        }

        if (!charts || charts.length === 0) {
          continue;
        }

        charts = normalizeAutoChartUnits(charts, table.rows);

        // Continue stable session ids from the current conversation branch.
        // instead of restarting at chart_1 on every request. The API derives
        // chart_id_offset from historical assistant placeholders before those
        // placeholders are stripped from model context. The per-run registry
        // still owns dedupe/max_charts and accounts for charts in this turn.
        const { agentId: chartAgentId, stepId: chartScopeStepId } =
          this.resolveChartScope(config, call.id);
        const autoGenerationKey = call.id || `${call.name}:${contentString}`;
        if (
          this.chartRunRegistry?.hasAutoGenerationKey(
            chartAgentId,
            chartScopeStepId,
            autoGenerationKey,
          )
        ) {
          continue;
        }
        // Mark before dispatching so repeated/concurrent graph entry cannot
        // create a second synthetic tool call for the same data call.
        this.chartRunRegistry?.markAutoGenerationKey(
          chartAgentId,
          chartScopeStepId,
          autoGenerationKey,
        );
        const conversationToken = safeConversationToken(
          config.configurable?.requestBody?.conversationId,
        );
        const configuredOffset = Number(
          conversationToken
            ? config.configurable?.chart_index_offset
            : config.configurable?.chart_id_offset,
        );
        const chartIdOffset =
          Number.isSafeInteger(configuredOffset) && configuredOffset >= 0
            ? configuredOffset
            : 0;
        const turnChartCount = this.chartRunRegistry?.countThisTurn(
          chartAgentId,
          chartScopeStepId
        ) ?? 0;
        const defaultPrefix =
          preset === 'indicator'
            ? 'zb'
            : preset === 'attribution'
              ? 'result'
              : 'chart';
        const configuredPrefix = safeChartPrefix(chartConfig?.marker, defaultPrefix);
        let nextChartIndex = chartIdOffset + turnChartCount;
        charts = charts.map((c) => {
          if (c && typeof c === 'object') {
            const chart = c as Record<string, unknown>;
            return {
              ...chart,
              id: conversationToken
                ? `${configuredPrefix}_${conversationToken}_${nextChartIndex++}`
                : `chart_${nextChartIndex++ + 1}`,
            };
          }
          return c;
        });

        // Apply the same cap/role rules before registering the synthetic UI
        // step. runTool repeats this check defensively, but doing it here
        // prevents a rejected duplicate from appearing as a second tool call.
        const preflight = this.trimChartsForRegistry(charts, config, call.id);
        if (preflight.rejected && preflight.charts.length === 0) {
          continue;
        }
        charts = preflight.charts;

        const syntheticId = `auto_chart_${call.id || nanoid()}`;
        const syntheticCall: ToolCall = {
          id: syntheticId,
          name: ECHARTS_TOOL_NAME,
          args: {
            charts,
            _autoGenerated: true,
          },
          type: 'tool_call',
        };

        const stepId = await this.dispatchSyntheticToolCall(
          syntheticCall,
          config
        );
        if (!stepId) {
          continue;
        }

        // Route through runTool so max_charts / registry apply uniformly
        const result = await this.runTool(syntheticCall, config);
        if (isCommand(result) || !isBaseMessage(result)) {
          continue;
        }
        const syntheticMessage = result as ToolMessage;
        const rawContent =
          typeof syntheticMessage.content === 'string'
            ? syntheticMessage.content
            : JSON.stringify(syntheticMessage.content);

        try {
          const parsed = JSON.parse(rawContent) as {
            success?: boolean;
            __echartsConfig?: boolean;
            skipped?: boolean;
          };
          if (parsed?.skipped === true) {
            continue;
          }
          if (parsed?.success !== true) {
            // Surface failure in UI stream without polluting graph state
            this.handleRunToolCompletions(
              [syntheticCall],
              [
                new ToolMessage({
                  status: 'error',
                  name: ECHARTS_TOOL_NAME,
                  content: truncateToolResultContent(
                    rawContent,
                    this.maxToolResultChars
                  ),
                  tool_call_id: syntheticId,
                }),
              ],
              config
            );
            continue;
          }
        } catch {
          continue;
        }

        this.toolCallTurns.set(syntheticId, 0);
        extraCalls.push(syntheticCall);
        extraOutputs.push(
          new ToolMessage({
            status: 'success',
            name: ECHARTS_TOOL_NAME,
            content: truncateToolResultContent(
              rawContent,
              this.maxToolResultChars
            ),
            tool_call_id: syntheticId,
          })
        );

        // One auto-chart invocation per successful data tool is enough;
        // further caps are handled by the registry inside runTool.
        break;
      }

      if (extraCalls.length > 0) {
        this.handleRunToolCompletions(extraCalls, extraOutputs, config);
      }
      return outputs;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[auto_chart] maybeInjectAutoCharts failed:', err);
      return outputs;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async run(input: any, config: RunnableConfig): Promise<T> {
    this.toolCallTurns.clear();
    let outputs: (BaseMessage | Command)[];

    if (this.isSendInput(input)) {
      const isDirectTool = this.directToolNames?.has(input.lg_tool_call.name);
      if (this.eventDrivenMode && isDirectTool !== true) {
        return this.executeViaEvent([input.lg_tool_call], config, input);
      }
      outputs = [await this.runTool(input.lg_tool_call, config)];
      this.handleRunToolCompletions([input.lg_tool_call], outputs, config);
      outputs = await this.maybeInjectAutoCharts(
        [input.lg_tool_call],
        outputs,
        config
      );
    } else {
      let messages: BaseMessage[];
      if (Array.isArray(input)) {
        messages = input;
      } else if (this.isMessagesState(input)) {
        messages = input.messages;
      } else {
        throw new Error(
          'ToolNode only accepts BaseMessage[] or { messages: BaseMessage[] } as input.'
        );
      }

      const toolMessageIds: Set<string> = new Set(
        messages
          .filter((msg) => msg._getType() === 'tool')
          .map((msg) => (msg as ToolMessage).tool_call_id)
      );

      let aiMessage: AIMessage | undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (isAIMessage(message)) {
          aiMessage = message;
          break;
        }
      }

      if (aiMessage == null || !isAIMessage(aiMessage)) {
        throw new Error('ToolNode only accepts AIMessages as input.');
      }

      if (this.loadRuntimeTools) {
        const { tools, toolMap } = this.loadRuntimeTools(
          aiMessage.tool_calls ?? []
        );
        this.toolMap =
          toolMap ?? new Map(tools.map((tool) => [tool.name, tool]));
        this.programmaticCache = undefined; // Invalidate cache on toolMap change
      }

      const filteredCalls =
        aiMessage.tool_calls?.filter((call) => {
          /**
           * Filter out:
           * 1. Already processed tool calls (present in toolMessageIds)
           * 2. Server tool calls (e.g., web_search with IDs starting with 'srvtoolu_')
           *    which are executed by the provider's API and don't require invocation
           */
          return (
            (call.id == null || !toolMessageIds.has(call.id)) &&
            !(
              call.id?.startsWith(Constants.ANTHROPIC_SERVER_TOOL_PREFIX) ??
              false
            )
          );
        }) ?? [];

      if (this.eventDrivenMode && filteredCalls.length > 0) {
        if (!this.directToolNames || this.directToolNames.size === 0) {
          return this.executeViaEvent(filteredCalls, config, input);
        }

        const directCalls = filteredCalls.filter((c) =>
          this.directToolNames!.has(c.name)
        );
        const eventCalls = filteredCalls.filter(
          (c) => !this.directToolNames!.has(c.name)
        );

        const directOutputs: (BaseMessage | Command)[] =
          directCalls.length > 0
            ? await Promise.all(
                directCalls.map((call) => this.runTool(call, config))
              )
            : [];

        if (directCalls.length > 0 && directOutputs.length > 0) {
          this.handleRunToolCompletions(directCalls, directOutputs, config);
        }

        const eventOutputs: ToolMessage[] =
          eventCalls.length > 0
            ? await this.dispatchToolEvents(eventCalls, config)
            : [];

        /**
         * Re-associate outputs with their originating call by tool_call_id,
         * then rebuild `outputs` in `filteredCalls`'s original (possibly
         * direct/event-interleaved) order. Two reasons this can't be simple
         * concatenation + index-based pairing (as it used to be):
         * 1. `[...directOutputs, ...eventOutputs]` groups by execution path,
         *    not by original call order — interleaved direct/event calls
         *    would misalign against `filteredCalls` at any index (i)
         *    downstream code (e.g. maybeInjectAutoCharts) pairs by.
         * 2. `dispatchToolEvents`'s results resolve via an external event
         *    handler and are not guaranteed to preserve the request order
         *    of `eventCalls` either — they must be matched by id, not
         *    position, even within the event group itself.
         * `directOutputs[i]` <-> `directCalls[i]` IS a safe positional pair
         * (Promise.all preserves array order), so we key off `directCalls`'
         * ids rather than trying to read an id back out of the output.
         */
        const directOutputById = new Map<string, BaseMessage | Command>();
        directCalls.forEach((call, i) => {
          if (call.id != null) {
            directOutputById.set(call.id, directOutputs[i]);
          }
        });
        const eventOutputById = new Map<string, ToolMessage>();
        for (const msg of eventOutputs) {
          eventOutputById.set(msg.tool_call_id, msg);
        }

        outputs = filteredCalls.map((call) => {
          const matched =
            (call.id != null ? directOutputById.get(call.id) : undefined) ??
            (call.id != null ? eventOutputById.get(call.id) : undefined);
          if (matched == null) {
            // Should be unreachable — every filteredCalls entry was routed
            // into exactly one of directCalls/eventCalls above — but fail
            // loudly rather than silently misaligning arrays downstream.
            throw new Error(
              `[ToolNode] No output found for tool_call_id=${call.id} (tool=${call.name}) after direct/event split.`
            );
          }
          return matched;
        });
        outputs = await this.maybeInjectAutoCharts(
          filteredCalls,
          outputs,
          config
        );
      } else {
        outputs = await Promise.all(
          filteredCalls.map((call) => this.runTool(call, config))
        );
        this.handleRunToolCompletions(filteredCalls, outputs, config);
        outputs = await this.maybeInjectAutoCharts(
          filteredCalls,
          outputs,
          config
        );
      }
    }

    if (!outputs.some(isCommand)) {
      return (Array.isArray(input) ? outputs : { messages: outputs }) as T;
    }

    const combinedOutputs: (
      | { messages: BaseMessage[] }
      | BaseMessage[]
      | Command
    )[] = [];
    let parentCommand: Command | null = null;

    /**
     * Collect handoff commands (Commands with string goto and Command.PARENT)
     * for potential parallel handoff aggregation
     */
    const handoffCommands: Command[] = [];
    const nonCommandOutputs: BaseMessage[] = [];

    for (const output of outputs) {
      if (isCommand(output)) {
        if (
          output.graph === Command.PARENT &&
          Array.isArray(output.goto) &&
          output.goto.every((send): send is Send => isSend(send))
        ) {
          /** Aggregate Send-based commands */
          if (parentCommand) {
            (parentCommand.goto as Send[]).push(...(output.goto as Send[]));
          } else {
            parentCommand = new Command({
              graph: Command.PARENT,
              goto: output.goto,
            });
          }
        } else if (output.graph === Command.PARENT) {
          /**
           * Handoff Command with destination.
           * Handle both string ('agent') and array (['agent']) formats.
           * Collect for potential parallel aggregation.
           */
          const goto = output.goto;
          const isSingleStringDest = typeof goto === 'string';
          const isSingleArrayDest =
            Array.isArray(goto) &&
            goto.length === 1 &&
            typeof goto[0] === 'string';

          if (isSingleStringDest || isSingleArrayDest) {
            handoffCommands.push(output);
          } else {
            /** Multi-destination or other command - pass through */
            combinedOutputs.push(output);
          }
        } else {
          /** Other commands - pass through */
          combinedOutputs.push(output);
        }
      } else {
        nonCommandOutputs.push(output);
        combinedOutputs.push(
          Array.isArray(input) ? [output] : { messages: [output] }
        );
      }
    }

    /**
     * Handle handoff commands - convert to Send objects for parallel execution
     * when multiple handoffs are requested
     */
    if (handoffCommands.length > 1) {
      /**
       * Multiple parallel handoffs - convert to Send objects.
       * Each Send carries its own state with the appropriate messages.
       * This enables LLM-initiated parallel execution when calling multiple
       * transfer tools simultaneously.
       */

      /** Collect all destinations for sibling tracking */
      const allDestinations = handoffCommands.map((cmd) => {
        const goto = cmd.goto;
        return typeof goto === 'string' ? goto : (goto as string[])[0];
      });

      const sends = handoffCommands.map((cmd, idx) => {
        const destination = allDestinations[idx];
        /** Get siblings (other destinations, not this one) */
        const siblings = allDestinations.filter((d) => d !== destination);

        /** Add siblings to ToolMessage additional_kwargs */
        const update = cmd.update as { messages?: BaseMessage[] } | undefined;
        if (update && update.messages) {
          for (const msg of update.messages) {
            if (msg.getType() === 'tool') {
              (msg as ToolMessage).additional_kwargs.handoff_parallel_siblings =
                siblings;
            }
          }
        }

        return new Send(destination, cmd.update);
      });

      const parallelCommand = new Command({
        graph: Command.PARENT,
        goto: sends,
      });
      combinedOutputs.push(parallelCommand);
    } else if (handoffCommands.length === 1) {
      /** Single handoff - pass through as-is */
      combinedOutputs.push(handoffCommands[0]);
    }

    if (parentCommand) {
      combinedOutputs.push(parentCommand);
    }

    return combinedOutputs as T;
  }

  private isSendInput(input: unknown): input is { lg_tool_call: ToolCall } {
    return (
      typeof input === 'object' && input != null && 'lg_tool_call' in input
    );
  }

  private isMessagesState(
    input: unknown
  ): input is { messages: BaseMessage[] } {
    return (
      typeof input === 'object' &&
      input != null &&
      'messages' in input &&
      Array.isArray((input as { messages: unknown }).messages) &&
      (input as { messages: unknown[] }).messages.every(isBaseMessage)
    );
  }
}

function areToolCallsInvoked(
  message: AIMessage,
  invokedToolIds?: Set<string>
): boolean {
  if (!invokedToolIds || invokedToolIds.size === 0) return false;
  return (
    message.tool_calls?.every(
      (toolCall) => toolCall.id != null && invokedToolIds.has(toolCall.id)
    ) ?? false
  );
}

export function toolsCondition<T extends string>(
  state: BaseMessage[] | typeof MessagesAnnotation.State,
  toolNode: T,
  invokedToolIds?: Set<string>
): T | typeof END {
  const messages = Array.isArray(state) ? state : state.messages;
  const message = messages[messages.length - 1] as AIMessage | undefined;

  if (
    message &&
    'tool_calls' in message &&
    (message.tool_calls?.length ?? 0) > 0 &&
    !areToolCallsInvoked(message, invokedToolIds)
  ) {
    return toolNode;
  }
  return END;
}
