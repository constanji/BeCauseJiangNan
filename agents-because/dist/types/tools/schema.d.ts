import { type StructuredToolInterface } from '@langchain/core/tools';
import type { LCTool } from '@/types';
/**
 * Creates a schema-only tool for LLM binding in event-driven mode.
 * These tools have valid schemas for the LLM to understand but should
 * never be invoked directly - ToolNode handles execution via events.
 */
export declare function createSchemaOnlyTool(definition: LCTool): StructuredToolInterface;
/**
 * Creates schema-only tools for all definitions in an array.
 */
export declare function createSchemaOnlyTools(definitions: LCTool[]): StructuredToolInterface[];
