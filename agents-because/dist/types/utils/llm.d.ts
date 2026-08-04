import { Providers } from '@/common';
export declare function isOpenAILike(provider?: string | Providers): boolean;
export declare function isGoogleLike(provider?: string | Providers): boolean;
/** Returns true for native Anthropic or Bedrock running a Claude model. */
export declare function isAnthropicLike(provider?: string | Providers, clientOptions?: {
    model?: string;
}): boolean;
