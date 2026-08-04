import './instrumentation';
import type { MessageContentComplex, BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type * as t from '@/types';
import { MultiAgentGraph } from '@/graphs/MultiAgentGraph';
import { StandardGraph } from '@/graphs/Graph';
export declare const defaultOmitOptions: Set<string>;
export declare class Run<_T extends t.BaseGraphState> {
    id: string;
    private tokenCounter?;
    private handlerRegistry?;
    private indexTokenCountMap?;
    calibrationRatio: number;
    graphRunnable?: t.CompiledStateWorkflow;
    Graph: StandardGraph | MultiAgentGraph | undefined;
    returnContent: boolean;
    private skipCleanup;
    private _streamResult;
    private constructor();
    private createLegacyGraph;
    private createMultiAgentGraph;
    static create<T extends t.BaseGraphState>(config: t.RunConfig): Promise<Run<T>>;
    getRunMessages(): BaseMessage[] | undefined;
    /**
     * Returns the current calibration ratio (EMA of provider-vs-estimate token ratios).
     * Hosts should persist this value and pass it back as `RunConfig.calibrationRatio`
     * on the next run for the same conversation so the pruner starts with an accurate
     * scaling factor instead of the default (1).
     */
    getCalibrationRatio(): number;
    getResolvedInstructionOverhead(): number | undefined;
    getToolCount(): number;
    /**
     * Creates a custom event callback handler that intercepts custom events
     * and processes them through our handler registry instead of EventStreamCallbackHandler
     */
    private createCustomEventCallback;
    processStream(inputs: t.IState, callerConfig: Partial<RunnableConfig> & {
        version: 'v1' | 'v2';
        run_id?: string;
    }, streamOptions?: t.EventStreamOptions): Promise<MessageContentComplex[] | undefined>;
    private createSystemCallback;
    getCallbacks(clientCallbacks: t.ClientCallbacks): t.SystemCallbacks;
    generateTitle({ provider, inputText, contentParts, titlePrompt, clientOptions, chainOptions, skipLanguage, titleMethod, titlePromptTemplate, }: t.RunTitleOptions): Promise<{
        language?: string;
        title?: string;
    }>;
}
