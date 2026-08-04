import { AIMessageChunk } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type * as t from '@/types';
import { ChatModelStreamHandler } from '@/stream';
import { Providers } from '@/common';
/**
 * Context passed to `attemptInvoke` for the default stream handler.
 * Matches the subset of Graph that `ChatModelStreamHandler.handle` needs.
 */
export type InvokeContext = Parameters<ChatModelStreamHandler['handle']>[3];
/**
 * Per-chunk callback for custom stream processing.
 * When provided, replaces the default `ChatModelStreamHandler`.
 */
export type OnChunk = (chunk: AIMessageChunk) => void | Promise<void>;
/**
 * Invokes a chat model with the given messages, handling both streaming and
 * non-streaming paths.
 *
 * By default, stream chunks are processed through a `ChatModelStreamHandler`
 * that dispatches run steps (MESSAGE_CREATION, TOOL_CALLS) for the graph.
 * Pass an `onChunk` callback to override this with custom chunk processing
 * (e.g. summarization delta events).
 */
export declare function attemptInvoke({ model, messages, provider, context, onChunk, }: {
    model: t.ChatModel;
    messages: BaseMessage[];
    provider: Providers;
    context?: InvokeContext;
    onChunk?: OnChunk;
}, config?: RunnableConfig): Promise<Partial<t.BaseGraphState>>;
/**
 * Attempts each fallback provider in order until one succeeds.
 * Throws the last error if all fallbacks fail.
 */
export declare function tryFallbackProviders({ fallbacks, tools, messages, config, primaryError, context, onChunk, }: {
    fallbacks: Array<{
        provider: Providers;
        clientOptions?: t.ClientOptions;
    }>;
    tools?: t.GraphTools;
    messages: BaseMessage[];
    config?: RunnableConfig;
    primaryError: unknown;
    context?: InvokeContext;
    onChunk?: OnChunk;
}): Promise<Partial<t.BaseGraphState> | undefined>;
