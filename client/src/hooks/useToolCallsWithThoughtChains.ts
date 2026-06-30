import { useEffect, useState, useRef } from 'react';
import { useChatContext } from '~/Providers';
import { extractToolCallsByMessage } from '~/utils/parseDatServerResponse';
import type { MessageToolCalls } from '~/utils/parseDatServerResponse';

/**
 * Hook 从当前消息中提取所有工具调用（按消息分组）
 * 返回按消息分组的工具调用数组，用于展示思维链
 */
export function useToolCallsWithThoughtChains(): {
  toolCallsByMessage: MessageToolCalls[];
} {
  const { getMessages } = useChatContext();
  const [toolCallsByMessage, setToolCallsByMessage] = useState<MessageToolCalls[]>([]);
  const lastMessagesHashRef = useRef<string>('');
  const lastToolCallsByMessageHashRef = useRef<string>('');

  // 用于检测工具调用的消息更新轮询
  useEffect(() => {
    const checkMessages = () => {
      try {
        const messages = getMessages();
        if (!messages || messages.length === 0) {
          if (toolCallsByMessage.length > 0) {
            setToolCallsByMessage([]);
            lastToolCallsByMessageHashRef.current = '';
            lastMessagesHashRef.current = '';
          }
          return;
        }

        // 创建消息的简单哈希来检测变化（避免不必要的解析）
        const messagesHash = JSON.stringify(
          messages.map((m: any) => ({
            id: m.messageId,
            contentLength: m.content?.length || 0,
            lastContentType: m.content?.[m.content.length - 1]?.type,
            unfinished: m.unfinished,
            contentSignature: m.content
              ?.map((part: any) => {
                if (!part) return null;
                if (part.type !== 'tool_call' && part.type !== 'think' && part.type !== 'text') {
                  return part.type;
                }

                const toolCall = part.tool_call ?? part.tool_call?.tool_call ?? null;
                if (part.type === 'tool_call' && toolCall) {
                  return {
                    t: 'tool_call',
                    id: toolCall.id ?? null,
                    name: toolCall.name ?? null,
                    argsLen:
                      typeof toolCall.args === 'string'
                        ? toolCall.args.length
                        : toolCall.args && typeof toolCall.args === 'object'
                          ? JSON.stringify(toolCall.args).length
                          : 0,
                    outputLen: typeof toolCall.output === 'string' ? toolCall.output.length : 0,
                    progress: toolCall.progress ?? null,
                  };
                }

                if (part.type === 'think') {
                  return {
                    t: 'think',
                    textLen:
                      typeof part.think === 'string'
                        ? part.think.length
                        : part.think?.value?.length ?? 0,
                  };
                }

                if (part.type === 'text') {
                  return {
                    t: 'text',
                    textLen:
                      typeof part.text === 'string'
                        ? part.text.length
                        : part.text?.value?.length ?? 0,
                    toolCallIds: part.tool_call_ids?.length ?? 0,
                  };
                }

                return null;
              })
              .filter(Boolean),
          })),
        );

        // 如果消息没有变化，跳过解析
        if (messagesHash === lastMessagesHashRef.current) {
          return;
        }

        lastMessagesHashRef.current = messagesHash;

        const extracted = extractToolCallsByMessage(messages);

        // 只在工具调用数据真正变化时更新状态
        const extractedHash = JSON.stringify(
          extracted.map((item) => ({
            messageId: item.messageId,
            messageIndex: item.messageIndex,
            isStreaming: item.isStreaming,
            toolCalls: item.toolCalls.map((toolCall) => ({
              id: toolCall.toolCall.id ?? null,
              name: toolCall.toolCall.name ?? null,
              argsLen:
                typeof toolCall.toolCall.args === 'string'
                  ? toolCall.toolCall.args.length
                  : toolCall.toolCall.args && typeof toolCall.toolCall.args === 'object'
                    ? JSON.stringify(toolCall.toolCall.args).length
                    : 0,
              outputLen:
                typeof toolCall.toolCall.output === 'string' ? toolCall.toolCall.output.length : 0,
              progress: toolCall.toolCall.progress ?? null,
            })),
          })),
        );

        if (extractedHash === lastToolCallsByMessageHashRef.current) {
          return;
        }

        lastToolCallsByMessageHashRef.current = extractedHash;
        setToolCallsByMessage(extracted);
      } catch (error) {
        console.warn('Error extracting tool calls:', error);
        if (toolCallsByMessage.length > 0) {
          setToolCallsByMessage([]);
          lastToolCallsByMessageHashRef.current = '';
          lastMessagesHashRef.current = '';
        }
      }
    };

    // 立刻检查
    checkMessages();

    // 增加轮询间隔到 1 秒，减少不必要的检查
    const interval = setInterval(checkMessages, 1000);

    return () => clearInterval(interval);
  }, [getMessages, toolCallsByMessage.length]);

  return {
    toolCallsByMessage,
  };
}
