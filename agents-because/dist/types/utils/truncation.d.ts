/**
 * Ingestion-time and pre-flight truncation utilities for tool results.
 *
 * Prevents oversized tool outputs from entering the message array and
 * consuming the entire context window.
 */
/**
 * Absolute hard cap on tool result length (characters).
 * Even if the model has a 1M-token context, a single tool result
 * larger than this is almost certainly a bug (e.g., dumping a binary file).
 */
export declare const HARD_MAX_TOOL_RESULT_CHARS = 400000;
/**
 * Computes the dynamic max tool result size based on the model's context window.
 * Uses 30% of the context window (in estimated characters, ~4 chars/token)
 * capped at HARD_MAX_TOOL_RESULT_CHARS.
 *
 * @param contextWindowTokens - The model's max context tokens (optional).
 * @returns Maximum allowed characters for a single tool result.
 */
export declare function calculateMaxToolResultChars(contextWindowTokens?: number): number;
/**
 * Truncates a tool-call input (the arguments/payload of a tool_use block)
 * using head+tail strategy. Returns an object with `_truncated` (the
 * truncated string) and `_originalChars` (for diagnostics).
 *
 * Accepts any type — objects are JSON-serialized before truncation.
 *
 * @param input - The tool input (string, object, etc.).
 * @param maxChars - Maximum allowed characters.
 */
export declare function truncateToolInput(input: unknown, maxChars: number): {
    _truncated: string;
    _originalChars: number;
};
/**
 * Truncates tool result content that exceeds `maxChars` using a head+tail
 * strategy. Keeps the beginning (structure/headers) and end (return value /
 * conclusion) of the content so the model retains both the opening context
 * and the final outcome.
 *
 * Head gets ~70% of the budget, tail gets ~30%. Falls back to head-only
 * when the budget is too small for a meaningful tail.
 *
 * @param content - The tool result string content.
 * @param maxChars - Maximum allowed characters.
 * @returns The (possibly truncated) content string.
 */
export declare function truncateToolResultContent(content: string, maxChars: number): string;
