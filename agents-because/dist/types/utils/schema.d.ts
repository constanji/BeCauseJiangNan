/**
 * Build an OpenAI-style tool JSON blob for token counting (aligned with
 * inline `toolDefinitions` shape in AgentContext).
 */
export declare function toJsonSchema(schema: unknown, toolName: string, description: string): {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};
