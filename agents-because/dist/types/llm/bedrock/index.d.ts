/**
 * Optimized ChatBedrockConverse wrapper that fixes contentBlockIndex conflicts
 *
 * Bedrock sends the same contentBlockIndex for both text and tool_use content blocks,
 * causing LangChain's merge logic to fail with "field[contentBlockIndex] already exists"
 * errors. This wrapper simply strips contentBlockIndex from response_metadata to avoid
 * the conflict.
 *
 * The contentBlockIndex field is only used internally by Bedrock's streaming protocol
 * and isn't needed by application logic - the index field on tool_call_chunks serves
 * the purpose of tracking tool call ordering.
 */
import { ChatBedrockConverse } from '@langchain/aws';
import type { ChatBedrockConverseInput } from '@langchain/aws';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
export declare class CustomChatBedrockConverse extends ChatBedrockConverse {
    constructor(fields?: ChatBedrockConverseInput);
    static lc_name(): string;
    /**
     * Override _streamResponseChunks to strip contentBlockIndex from response_metadata
     * This prevents LangChain's merge conflicts when the same index is used for
     * different content types (text vs tool calls)
     */
    _streamResponseChunks(messages: BaseMessage[], options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): AsyncGenerator<ChatGenerationChunk>;
    /**
     * Check if contentBlockIndex exists at any level in the object
     */
    private hasContentBlockIndex;
    /**
     * Recursively remove contentBlockIndex from all levels of an object
     */
    private removeContentBlockIndex;
}
export type { ChatBedrockConverseInput };
