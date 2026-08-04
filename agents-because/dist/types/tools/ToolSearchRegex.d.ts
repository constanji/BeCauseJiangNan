import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type * as t from '@/types';
declare const ToolSearchRegexSchema: z.ZodObject<{
    query: z.ZodString;
    fields: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodEnum<["name", "description", "parameters"]>, "many">>>;
    max_results: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    query: string;
    fields: ("name" | "description" | "parameters")[];
    max_results: number;
}, {
    query: string;
    fields?: ("name" | "description" | "parameters")[] | undefined;
    max_results?: number | undefined;
}>;
/**
 * Escapes special regex characters in a string to use as a literal pattern.
 * @param pattern - The string to escape
 * @returns The escaped string safe for use in a RegExp
 */
declare function escapeRegexSpecialChars(pattern: string): string;
/**
 * Counts the maximum nesting depth of groups in a regex pattern.
 * @param pattern - The regex pattern to analyze
 * @returns The maximum nesting depth
 */
declare function countNestedGroups(pattern: string): number;
/**
 * Detects nested quantifiers that can cause catastrophic backtracking.
 * Patterns like (a+)+, (a*)*, (a+)*, etc.
 * @param pattern - The regex pattern to check
 * @returns True if nested quantifiers are detected
 */
declare function hasNestedQuantifiers(pattern: string): boolean;
/**
 * Checks if a regex pattern contains potentially dangerous constructs.
 * @param pattern - The regex pattern to validate
 * @returns True if the pattern is dangerous
 */
declare function isDangerousPattern(pattern: string): boolean;
/**
 * Sanitizes a regex pattern for safe execution.
 * If the pattern is dangerous, it will be escaped to a literal string search.
 * @param pattern - The regex pattern to sanitize
 * @returns Object containing the safe pattern and whether it was escaped
 */
declare function sanitizeRegex(pattern: string): {
    safe: string;
    wasEscaped: boolean;
};
/**
 * Creates a Tool Search Regex tool for discovering tools from a large registry.
 *
 * This tool enables AI agents to dynamically discover tools from a large library
 * without loading all tool definitions into the LLM context window. The agent
 * can search for relevant tools on-demand using regex patterns.
 *
 * The tool registry can be provided either:
 * 1. At initialization time via params.toolRegistry
 * 2. At runtime via config.configurable.toolRegistry when invoking
 *
 * @param params - Configuration parameters for the tool (toolRegistry is optional)
 * @returns A LangChain DynamicStructuredTool for tool searching
 *
 * @example
 * // Option 1: Registry at initialization
 * const tool = createToolSearchRegexTool({ apiKey, toolRegistry });
 * await tool.invoke({ query: 'expense' });
 *
 * @example
 * // Option 2: Registry at runtime
 * const tool = createToolSearchRegexTool({ apiKey });
 * await tool.invoke(
 *   { query: 'expense' },
 *   { configurable: { toolRegistry, onlyDeferred: true } }
 * );
 */
declare function createToolSearchRegexTool(initParams?: t.ToolSearchRegexParams): DynamicStructuredTool<typeof ToolSearchRegexSchema>;
export { createToolSearchRegexTool, sanitizeRegex, escapeRegexSpecialChars, isDangerousPattern, countNestedGroups, hasNestedQuantifiers, };
