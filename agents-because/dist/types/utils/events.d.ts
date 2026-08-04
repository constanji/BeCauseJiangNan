import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentLogEvent } from '@/types/graph';
/**
 * Safely dispatches a custom event and properly awaits it to avoid
 * race conditions where events are dispatched after run cleanup.
 */
export declare function safeDispatchCustomEvent(event: string, payload: unknown, config?: RunnableConfig): Promise<void>;
/**
 * Fire-and-forget diagnostic log event.
 * Debug-level logs are gated behind AGENT_DEBUG_LOGGING=true to avoid
 * overhead in production. Info/warn/error always flow through.
 * Pass `force: true` to bypass the env-var gate (e.g. invoke timing).
 */
export declare function emitAgentLog(config: RunnableConfig | undefined, level: AgentLogEvent['level'], scope: AgentLogEvent['scope'], message: string, data?: Record<string, unknown>, meta?: {
    runId?: string;
    agentId?: string;
}, options?: {
    force?: boolean;
}): void;
