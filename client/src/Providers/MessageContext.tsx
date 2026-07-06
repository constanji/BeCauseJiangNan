import { createContext, useContext } from 'react';
import type { EChartsChartData } from '~/components/Chat/Messages/Content/EChartsChart';

type MessageContext = {
  messageId: string;
  nextType?: string;
  partIndex?: number;
  isExpanded: boolean;
  conversationId?: string | null;
  /** Submission state for cursor display - only true for latest message when submitting */
  isSubmitting?: boolean;
  /** Whether this is the latest message in the conversation */
  isLatestMessage?: boolean;
  /** Charts from echarts_generator_app tool calls, keyed by chart id for @ec@ marker lookup */
  echartsChartsById?: Map<string, EChartsChartData>;
};

export const MessageContext = createContext<MessageContext>({} as MessageContext);
export const useMessageContext = () => useContext(MessageContext);
