import type { BaseMessage } from '@langchain/core/messages';
export type EncodingName = 'o200k_base' | 'claude';
/**
 * Extracts image dimensions from the first bytes of a base64-encoded
 * PNG, JPEG, GIF, or WebP without decoding the full image.
 * Returns null if the format is unrecognized or data is too short.
 */
export declare function extractImageDimensions(base64Data: string): {
    width: number;
    height: number;
} | null;
/** Estimates image token cost for Anthropic/Bedrock (Claude). */
export declare function estimateAnthropicImageTokens(width: number, height: number): number;
/** Estimates image token cost for OpenAI (high detail). */
export declare function estimateOpenAIImageTokens(width: number, height: number, detail?: string): number;
export declare function encodingForModel(model: string): EncodingName;
export declare function getTokenCountForMessage(message: BaseMessage, getTokenCount: (text: string) => number, encoding?: EncodingName): number;
/**
 * Creates a token counter function using the specified encoding.
 * Lazily loads the encoding data on first use via dynamic import.
 */
export declare const createTokenCounter: (encoding?: EncodingName) => Promise<(message: BaseMessage) => number>;
/** Utility to manage the token encoder lifecycle explicitly. */
export declare const TokenEncoderManager: {
    initialize(): Promise<void>;
    reset(): void;
    isInitialized(): boolean;
};
