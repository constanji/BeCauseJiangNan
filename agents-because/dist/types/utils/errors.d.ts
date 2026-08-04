/**
 * Context overflow error detection utilities.
 *
 * Identifies provider-specific error messages that indicate the request
 * exceeded the model's context window. Used by the overflow recovery loop
 * to decide whether to retry with truncation/compaction vs. propagating
 * the error.
 */
/**
 * Extracts a human-readable error message from an unknown error value.
 */
export declare function extractErrorMessage(error: unknown): string;
/**
 * Returns true if the error message definitively indicates a context
 * overflow / prompt-too-large error from the provider.
 *
 * This is the strict check: only matches known, unambiguous phrases.
 * Use this when you want high confidence before taking recovery action.
 */
export declare function isContextOverflowError(errorMessage?: string): boolean;
/**
 * Returns true if the error message likely indicates a context overflow.
 * Uses broader heuristic matching (regex) in addition to exact phrases.
 *
 * May produce false positives for unusual error messages. Use this when
 * the cost of a false positive (one extra retry) is acceptable.
 */
export declare function isLikelyContextOverflowError(errorMessage?: string): boolean;
