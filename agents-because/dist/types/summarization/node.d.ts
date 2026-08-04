import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { AgentContext } from '@/agents/AgentContext';
import type * as t from '@/types';
/** Structured checkpoint prompt for fresh summarization (no prior summary). */
export declare const DEFAULT_SUMMARIZATION_PROMPT = "Hold on, before you continue I need you to write me a checkpoint of everything so far. Your context window is filling up and this checkpoint replaces the messages above, so capture everything you need to pick right back up.\n\nDon't second-guess or fact-check anything you did, your tool results reflect exactly what happened. If a tool result appears truncated, that's just a display artifact from context management: the tool executed fully. Just record what you did and what you observed. Only the checkpoint, don't respond to me or continue the conversation.\n\n## Checkpoint\n\n## Goal\nWhat I asked you to do and any sub-goals you identified.\n\n## Constraints & Preferences\nAny rules, preferences, or configuration I established.\n\n## Progress\n### Done\n- What you completed and the outcomes\n\n### In Progress\n- What you're currently working on\n\n## Key Decisions\nDecisions you made and why.\n\n## Next Steps\nConcrete task actions remaining, in priority order.\n\n## Critical Context\nExact identifiers, names, error messages, URLs, and details you need to preserve verbatim.\n\nRules:\n- Record what you did and observed, don't judge or re-evaluate it\n- For each tool call: the tool name, key inputs, and the outcome\n- Preserve exact identifiers, names, errors, and references verbatim\n- Short declarative sentences\n- Skip empty sections";
/** Prompt for re-compaction when a prior summary exists. */
export declare const DEFAULT_UPDATE_SUMMARIZATION_PROMPT = "Hold on again, update your checkpoint. Merge the new messages into your existing checkpoint and give me a single consolidated replacement.\n\nKeep it roughly the same length as your last checkpoint. Compress older details to make room for what's new, don't just append. Give recent actions more detail, compress older items to one-liners.\n\nDon't fact-check or second-guess anything, your tool results are ground truth. If a tool result appears truncated, that's just a display artifact: the tool executed fully. Only the checkpoint, don't respond to me or continue the conversation.\n\nRules:\n- Merge new progress into existing sections, don't duplicate headers\n- Compress older completed items into one-line entries\n- Move items from \"In Progress\" to \"Done\" when you completed them\n- Update \"Next Steps\" to reflect current task priorities.\n- For each new tool call: the tool name, key inputs, and the outcome\n- Preserve exact identifiers, names, errors, and references verbatim\n- Skip empty sections";
interface CreateSummarizeNodeParams {
    agentContext: AgentContext;
    graph: {
        contentData: t.RunStep[];
        contentIndexMap: Map<string, number>;
        config?: RunnableConfig;
        runId?: string;
        isMultiAgent: boolean;
        dispatchRunStep: (runStep: t.RunStep, config?: RunnableConfig) => Promise<void>;
        dispatchRunStepCompleted: (stepId: string, result: t.StepCompleted, config?: RunnableConfig) => Promise<void>;
    };
    generateStepId: (stepKey: string) => [string, number];
}
export declare function createSummarizeNode({ agentContext, graph, generateStepId, }: CreateSummarizeNodeParams): (state: {
    messages: BaseMessage[];
    summarizationRequest?: t.SummarizationNodeInput;
}, config?: RunnableConfig) => Promise<{
    summarizationRequest: undefined;
    messages?: BaseMessage[];
}>;
export {};
