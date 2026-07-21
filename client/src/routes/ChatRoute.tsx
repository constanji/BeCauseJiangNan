import { useEffect } from 'react';
import { Spinner } from '@because/client';
import { useParams, useNavigate } from 'react-router-dom';
import { Constants, EModelEndpoint, QueryKeys } from '@because/data-provider';
import { useGetModelsQuery } from '@because/data-provider/react-query';
import { useQueryClient } from '@tanstack/react-query';
import type { TPreset } from '@because/data-provider';
import { useGetConvoIdQuery, useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import { useNewConvo, useAppStartup, useAssistantListMap, useIdChangeEffect } from '~/hooks';
import { getDefaultModelSpec, getModelSpecPreset, logger } from '~/utils';
import { ToolCallsMapProvider } from '~/Providers';
import ChatView from '~/components/Chat/ChatView';
import useAuthRedirect from './useAuthRedirect';
import temporaryStore from '~/store/temporary';
import { useRecoilCallback } from 'recoil';
import store from '~/store';

export default function ChatRoute() {
  const { data: startupConfig } = useGetStartupConfig();
  const { isAuthenticated, user } = useAuthRedirect();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const setIsTemporary = useRecoilCallback(
    ({ set }) =>
      (value: boolean) => {
        set(temporaryStore.isTemporary, value);
      },
    [],
  );
  useAppStartup({ startupConfig, user });

  const index = 0;
  const { conversationId = '' } = useParams();
  useIdChangeEffect(conversationId);
  const { hasSetConversation, conversation } = store.useCreateConversationAtom(index);
  const { newConversation } = useNewConvo();

  const modelsQuery = useGetModelsQuery({
    enabled: isAuthenticated,
    refetchOnMount: 'always',
  });
  const initialConvoQuery = useGetConvoIdQuery(conversationId, {
    enabled:
      isAuthenticated && conversationId !== Constants.NEW_CONVO && !hasSetConversation.current,
  });
  const endpointsQuery = useGetEndpointsQuery({ enabled: isAuthenticated });
  const assistantListMap = useAssistantListMap();

  const isTemporaryChat = conversation && conversation.expiredAt ? true : false;

  /**
   * useGetModelsQuery 使用 initialData（含 initial: []）。
   * `!modelsQuery.data?.initial` 在 initial=[] 时恒为 false（[] 为 truthy），
   * 且 initialData 下 isLoading 恒为 false → /c/new 会 return null 白屏。
   * 占位期间若仍在拉取则等待；拉取结束（成功替换或失败留下占位）后允许初始化。
   */
  const isModelsPlaceholder = Array.isArray(modelsQuery.data?.initial);
  const waitingForModels =
    isModelsPlaceholder && (modelsQuery.isFetching || modelsQuery.isLoading);

  // 处理404错误：对话不存在时重定向到新对话
  useEffect(() => {
    if (
      conversationId &&
      conversationId !== Constants.NEW_CONVO &&
      !initialConvoQuery.isLoading &&
      initialConvoQuery.data === null &&
      !hasSetConversation.current
    ) {
      logger.warn('conversation', `Conversation ${conversationId} not found, redirecting to new conversation`);
      // 清除所有相关的查询缓存，避免在跳转过程中触发404
      queryClient.removeQueries({ queryKey: [QueryKeys.conversation, conversationId] });
      queryClient.removeQueries({ queryKey: [QueryKeys.messages, conversationId] });
      // 使用window.location.replace确保完全清除URL中的旧ID，避免循环404
      window.location.replace(`/c/${Constants.NEW_CONVO}`);
    }
  }, [conversationId, initialConvoQuery.isLoading, initialConvoQuery.data, hasSetConversation, queryClient]);

  useEffect(() => {
    if (conversationId !== Constants.NEW_CONVO && !isTemporaryChat) {
      setIsTemporary(false);
    } else if (isTemporaryChat) {
      setIsTemporary(isTemporaryChat);
    }
  }, [conversationId, isTemporaryChat, setIsTemporary]);

  /** This effect is mainly for the first conversation state change on first load of the page.
   *  Adjusting this may have unintended consequences on the conversation state.
   */
  useEffect(() => {
    const shouldSetConvo = Boolean(
      startupConfig && !hasSetConversation.current && modelsQuery.data && !waitingForModels,
    );
    /* Early exit if startupConfig is not loaded and conversation is already set and only initial models have loaded */
    if (!shouldSetConvo) {
      return;
    }

    if (conversationId === Constants.NEW_CONVO && endpointsQuery.data && modelsQuery.data) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      logger.log('conversation', 'ChatRoute, new convo effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });

      hasSetConversation.current = true;
    } else if (initialConvoQuery.data && endpointsQuery.data && modelsQuery.data) {
      logger.log('conversation', 'ChatRoute initialConvoQuery', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        /* this is necessary to load all existing settings */
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    } else if (
      conversationId === Constants.NEW_CONVO &&
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      logger.log('conversation', 'ChatRoute new convo, assistants effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      logger.log('conversation', 'ChatRoute convo, assistants effect', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    }
    /* Creates infinite render if all dependencies included due to newConversation invocations exceeding call stack before hasSetConversation.current becomes truthy */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startupConfig,
    initialConvoQuery.data,
    endpointsQuery.data,
    modelsQuery.data,
    assistantListMap,
    waitingForModels,
  ]);

  const showBootstrapSpinner =
    endpointsQuery.isLoading ||
    waitingForModels ||
    (Boolean(conversationId) &&
      conversationId !== Constants.SEARCH &&
      !conversation &&
      isAuthenticated);

  if (showBootstrapSpinner) {
    return (
      <div className="flex h-screen items-center justify-center" aria-live="polite" role="status">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // if not a conversation
  if (conversation?.conversationId === Constants.SEARCH) {
    return null;
  }
  // if conversationId is null
  if (!conversationId) {
    return null;
  }
  if (!conversation) {
    return (
      <div className="flex h-screen items-center justify-center" aria-live="polite" role="status">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  return (
    <ToolCallsMapProvider conversationId={conversation.conversationId ?? ''}>
      <ChatView index={index} />
    </ToolCallsMapProvider>
  );
}
