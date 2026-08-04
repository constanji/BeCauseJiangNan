import type * as t from '@/types';
import { Providers } from '@/common';
/**
 * Returns true when the provider + clientOptions indicate extended thinking
 * is enabled.  Works across Anthropic (direct), Bedrock (additionalModelRequestFields),
 * and OpenAI-compat (modelKwargs.thinking).
 */
export declare function isThinkingEnabled(provider: Providers, clientOptions?: t.ClientOptions): boolean;
/**
 * Returns the correct key for setting max output tokens on the model
 * constructor options.  Google/Vertex use `maxOutputTokens`, all others
 * use `maxTokens`.
 */
export declare function getMaxOutputTokensKey(provider: Providers | string): 'maxOutputTokens' | 'maxTokens';
