import { z } from 'zod';
/** Demo tool: returns a random image URL payload (used by scripts/image). */
export declare const fetchRandomImageTool: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>, any, any, string>;
/** Demo tool: returns only a URL string. */
export declare const fetchRandomImageURL: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>, any, any, string>;
