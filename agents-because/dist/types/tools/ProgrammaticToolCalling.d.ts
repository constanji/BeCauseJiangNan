import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type * as t from '@/types';
declare const ProgrammaticToolCallingSchema: z.ZodObject<{
    code: z.ZodString;
    session_id: z.ZodOptional<z.ZodString>;
    timeout: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    code: string;
    timeout: number;
    session_id?: string | undefined;
}, {
    code: string;
    timeout?: number | undefined;
    session_id?: string | undefined;
}>;
/**
 * Normalizes a tool name to Python identifier format.
 * Must match the Code API's `normalizePythonFunctionName` exactly:
 * 1. Replace hyphens and spaces with underscores
 * 2. Remove any other invalid characters
 * 3. Prefix with underscore if starts with number
 * 4. Append `_tool` if it's a Python keyword
 * @param name - The tool name to normalize
 * @returns Normalized Python-safe identifier
 */
export declare function normalizeToPythonIdentifier(name: string): string;
/**
 * Extracts tool names that are actually called in the Python code.
 * Handles hyphen/underscore conversion since Python identifiers use underscores.
 * @param code - The Python code to analyze
 * @param toolNameMap - Map from normalized Python name to original tool name
 * @returns Set of original tool names found in the code
 */
export declare function extractUsedToolNames(code: string, toolNameMap: Map<string, string>): Set<string>;
/**
 * Filters tool definitions to only include tools actually used in the code.
 * Handles the hyphen-to-underscore conversion for Python compatibility.
 * @param toolDefs - All available tool definitions
 * @param code - The Python code to analyze
 * @param debug - Enable debug logging
 * @returns Filtered array of tool definitions
 */
export declare function filterToolsByUsage(toolDefs: t.LCTool[], code: string, debug?: boolean): t.LCTool[];
/**
 * Makes an HTTP request to the Code API.
 * @param endpoint - The API endpoint URL
 * @param apiKey - The API key for authentication
 * @param body - The request body
 * @param proxy - Optional HTTP proxy URL
 * @returns The parsed API response
 */
export declare function makeRequest(endpoint: string, apiKey: string, body: Record<string, unknown>, proxy?: string): Promise<t.ProgrammaticExecutionResponse>;
/**
 * Executes tools in parallel when requested by the API.
 * Uses Promise.all for parallel execution, catching individual errors.
 * @param toolCalls - Array of tool calls from the API
 * @param toolMap - Map of tool names to executable tools
 * @returns Array of tool results
 */
export declare function executeTools(toolCalls: t.PTCToolCall[], toolMap: t.ToolMap): Promise<t.PTCToolResult[]>;
/**
 * Formats the completed response for the agent.
 * @param response - The completed API response
 * @returns Tuple of [formatted string, artifact]
 */
export declare function formatCompletedResponse(response: t.ProgrammaticExecutionResponse): [string, t.ProgrammaticExecutionArtifact];
/**
 * Creates a Programmatic Tool Calling tool for complex multi-tool workflows.
 *
 * This tool enables AI agents to write Python code that orchestrates multiple
 * tool calls programmatically, reducing LLM round-trips and token usage.
 *
 * The tool map must be provided at runtime via config.configurable.toolMap.
 *
 * @param params - Configuration parameters (apiKey, baseUrl, maxRoundTrips, proxy)
 * @returns A LangChain DynamicStructuredTool for programmatic tool calling
 *
 * @example
 * const ptcTool = createProgrammaticToolCallingTool({
 *   apiKey: process.env.CODE_API_KEY,
 *   maxRoundTrips: 20
 * });
 *
 * const [output, artifact] = await ptcTool.invoke(
 *   { code, tools },
 *   { configurable: { toolMap } }
 * );
 */
export declare function createProgrammaticToolCallingTool(initParams?: t.ProgrammaticToolCallingParams): DynamicStructuredTool<typeof ProgrammaticToolCallingSchema>;
export {};
