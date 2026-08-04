import type { Runnable } from '@langchain/core/runnables';
import type * as t from '@/types';
import { Providers } from '@/common';
/**
 * Creates a chat model instance for a given provider, applies provider-specific
 * field assignments, and optionally binds tools.
 *
 * This is the single entry point for model creation across the codebase — used
 * by both the agent graph (main LLM) and the summarization node (compaction LLM).
 * An optional `override` model can be passed to skip construction entirely
 * (useful for cached/reused model instances or test fakes).
 */
export declare function initializeModel({ provider, clientOptions, tools, override, }: {
    provider: Providers;
    clientOptions?: t.ClientOptions;
    tools?: t.GraphTools;
    override?: t.ChatModelInstance;
}): Runnable;
