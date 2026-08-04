import type { ChatModelConstructorMap, ProviderOptionsMap, ChatModelMap } from '@/types';
export declare const llmProviders: Partial<ChatModelConstructorMap>;
export declare const manualToolStreamProviders: Set<string>;
export declare const getChatModelClass: <P extends keyof ProviderOptionsMap>(provider: P) => new (config: ProviderOptionsMap[P]) => ChatModelMap[P];
