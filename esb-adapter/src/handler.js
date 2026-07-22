const { config, resolveSceneConfig } = require('./config');
const { chatStream } = require('./becauseClient');
const { logger, describeError } = require('./logger');
const { buildDelta } = require('./sseParser');
const {
  validateEsbRequest,
  buildSuccessResponse,
  buildErrorResponse,
  buildSystemErrorResponse,
} = require('./esbParser');
const { resolveConversationId, resolveParentMessageId } = require('./conversationStore');
const { appendQueryContextToText } = require('./queryContext');
const {
  createStreamTask,
  appendChunk,
  markDone,
  markRunningMeta,
  setEchartdata,
  setSimilarQuestions,
  setAttributionData,
  touchTask,
  readPollState,
  removeTask,
  getTask,
} = require('./streamStore');

const EMPTY_ANSWER_ERROR =
  'Because 未返回有效回复，请检查 scene 对应的 Agent ID 与 BECAUSE_BASE_URL 是否配置正确';

function getMsgId(sysHeader) {
  return sysHeader?.msgId || '';
}

function logFields(sysHeader, bizBody, extra = {}) {
  return {
    msgId: getMsgId(sysHeader),
    scene: bizBody?.scene ? String(bizBody.scene).trim() : undefined,
    streamId: bizBody?.streamId ? String(bizBody.streamId).trim() : undefined,
    user: bizBody?.userNum,
    orgCode: bizBody?.orgCode,
    ...extra,
  };
}

function hasStreamContent(task, result = {}) {
  const answer = String(task?.answer || result.answer || '').trim();
  const charts = result.extras?.chartBlocks?.length || task?.echartdata?.length || 0;
  return answer.length > 0 || charts > 0;
}

function finalizeStreamFromResult(
  streamId,
  result,
  { conversationId, parentMessageId, title, logContext },
) {
  const currentTask = getTask(streamId);
  if (currentTask) {
    // 用与流式增量一致的 buildDelta 计算「补发尾部」，而非单纯按长度 slice：
    // 若 result.answer 与已累积的 currentTask.answer 不是简单的前缀延续关系（例如流式阶段
    // 已经包含 result.answer 的内容），按长度硬切会拼出错位甚至重复的文本。
    const missingTail = buildDelta(currentTask.answer, result.answer || '');
    if (missingTail) {
      appendChunk(streamId, missingTail);
    }
  }

  const updatedTask = getTask(streamId);
  if (!hasStreamContent(updatedTask, result)) {
    logger.warn('STREAM_EMPTY', {
      ...logContext,
      streamId,
      conversationId: result.conversationId || conversationId,
    });
    markDone(streamId, {
      error: EMPTY_ANSWER_ERROR,
      conversationId: result.conversationId || conversationId,
    });
    return;
  }

  markDone(streamId, {
    conversationId: result.conversationId || conversationId,
    parentMessageId: result.parentMessageId || parentMessageId || null,
    title: result.title || title || null,
  });

  logger.info('STREAM_DONE', {
    ...logContext,
    streamId,
    conversationId: result.conversationId || conversationId,
    parentMessageId: result.parentMessageId || parentMessageId || null,
    answerLen: String(updatedTask?.answer || result.answer || '').length,
    chartCount: updatedTask?.echartdata?.length || result.extras?.chartBlocks?.length || 0,
    durationMs: updatedTask?.createdAt ? Date.now() - updatedTask.createdAt : undefined,
  });
}

function resolveAgentId(bizBody, { isPoll, streamId } = {}) {
  if (bizBody.agentId) {
    const agentId = String(bizBody.agentId).trim();
    const becauseBaseUrl = config.becauseBaseUrl;
    if (!becauseBaseUrl) {
      return { error: '未配置 BECAUSE_BASE_URL（显式 agentId 时使用默认地址）' };
    }
    return { agentId, becauseBaseUrl };
  }

  if (isPoll && streamId) {
    const task = getTask(streamId);
    if (task?.agentId) {
      return {
        agentId: task.agentId,
        scene: task.scene || undefined,
        becauseBaseUrl: task.becauseBaseUrl || config.becauseBaseUrl,
      };
    }
  }

  const scene = String(bizBody.scene || '').trim();
  if (!scene) {
    return { error: 'bizBody 缺少 scene（智能体场景标识）' };
  }

  const resolved = resolveSceneConfig(scene);
  if (!resolved.ok) {
    return { error: resolved.error };
  }

  return {
    agentId: resolved.agentId,
    scene: resolved.scene,
    becauseBaseUrl: resolved.becauseBaseUrl,
  };
}

async function handleEsbTransaction(body) {
  const validated = validateEsbRequest(body);
  if (!validated.ok) {
    logger.warn('REQUEST_INVALID', {
      error: validated.error,
      msgId: getMsgId(validated.sysHeader),
    });
    return buildSystemErrorResponse(validated.error, validated.sysHeader);
  }

  const { sysHeader, bizBody } = validated;
  const isPolling = !!(bizBody.streamId && String(bizBody.streamId).trim());
  const streamId = isPolling ? String(bizBody.streamId).trim() : null;

  const resolved = resolveAgentId(bizBody, { isPoll: isPolling, streamId });

  if (resolved.error) {
    logger.warn('ROUTE_FAILED', logFields(sysHeader, bizBody, {
      mode: isPolling ? 'POLL' : 'START',
      error: resolved.error,
    }));
    return buildErrorResponse(sysHeader, bizBody, resolved.error);
  }

  const agentId = resolved.agentId;
  const resolvedScene = resolved.scene || String(bizBody.scene || '').trim() || undefined;
  const becauseBaseUrl = resolved.becauseBaseUrl;

  const routeFields = logFields(sysHeader, bizBody, {
    mode: isPolling ? 'POLL' : 'START',
    scene: resolvedScene,
    agentId,
    becauseBaseUrl,
  });

  // 中间 POLL 的入站/路由日志默认关闭（LOG_POLL_STATE=true 时开启）；START 始终记录
  if (!isPolling || config.logPollState) {
    logger.info(isPolling ? 'POLL_IN' : 'REQUEST_IN', routeFields);
    logger.info('ROUTE_RESOLVED', routeFields);
  }

  if (isPolling) {
    return handlePollRequest({ sysHeader, bizBody, agentId, scene: resolvedScene });
  }
  return handleStartStreamRequest({
    sysHeader,
    bizBody,
    agentId,
    scene: resolvedScene,
    becauseBaseUrl,
  });
}

function buildStreamPayload(streamId, chunkInfo) {
  return {
    streamId,
    seq: chunkInfo.seq,
    chunk: chunkInfo.chunk || '',
    isFinal: chunkInfo.isFinal ? 'Y' : 'N',
    conversationId: chunkInfo.conversationId || null,
    parentMessageId: chunkInfo.parentMessageId || null,
    // 累计全文；chunk 为相对上轮已下发 answer 的新增尾部，二者满足 answer.endsWith(已下发) 且 chunk 为剩余前缀。
    answer: chunkInfo.answer || '',
    title: chunkInfo.title || null,
    echartdata: chunkInfo.echartdata || null,
    similarQuestions: chunkInfo.similarQuestions || null,
    attributiondata: chunkInfo.attributiondata || null,
  };
}

function handlePollRequest({ sysHeader, bizBody, agentId, scene }) {
  const streamId = String(bizBody.streamId || '').trim();
  const task = getTask(streamId);
  if (!task) {
    logger.warn('POLL_INVALID_STREAM', logFields(sysHeader, bizBody));
    return buildErrorResponse(sysHeader, bizBody, `streamId 无效或已过期: ${streamId}`);
  }

  const chunkInfo = readPollState(streamId, {
    maxChunkChars: config.streamPollBatchMaxChars,
  });
  if (!chunkInfo) {
    logger.warn('POLL_INVALID_STREAM', logFields(sysHeader, bizBody));
    return buildErrorResponse(sysHeader, bizBody, `streamId 无效或已过期: ${streamId}`);
  }

  if (config.logPollState || chunkInfo.isFinal || chunkInfo.error) {
    logger.info('POLL_STATE', logFields(sysHeader, bizBody, {
      scene: scene || task.scene,
      agentId: agentId || task.agentId,
      seq: chunkInfo.seq,
      isFinal: chunkInfo.isFinal ? 'Y' : 'N',
      done: chunkInfo.done ? 'Y' : 'N',
      chunkLen: String(chunkInfo.chunk || '').length,
      answerLen: String(chunkInfo.answer || '').length,
      durationMs: task.createdAt ? Date.now() - task.createdAt : undefined,
    }));
  }

  if (chunkInfo.done && chunkInfo.error && chunkInfo.isFinal) {
    logger.error('POLL_FINAL_ERROR', logFields(sysHeader, bizBody, {
      scene: scene || task.scene,
      agentId: agentId || task.agentId,
      seq: chunkInfo.seq,
      error: chunkInfo.error,
      durationMs: task.createdAt ? Date.now() - task.createdAt : undefined,
    }));
    const errorResponse = buildErrorResponse(sysHeader, bizBody, chunkInfo.error);
    const payload = errorResponse.Transaction.Body.response.bizBody;
    payload.streamId = streamId;
    payload.seq = chunkInfo.seq;
    payload.chunk = chunkInfo.chunk || '';
    payload.isFinal = 'Y';
    payload.conversationId = chunkInfo.conversationId || null;
    payload.parentMessageId = chunkInfo.parentMessageId || null;
    payload.answer = chunkInfo.answer || '';
    removeTask(streamId);
    return errorResponse;
  }

  const response = buildSuccessResponse(sysHeader, bizBody, buildStreamPayload(streamId, chunkInfo));
  if (chunkInfo.isFinal) {
    const answer = (chunkInfo.answer || '').trim();
    const hasCharts = Array.isArray(chunkInfo.echartdata) && chunkInfo.echartdata.length > 0;
    if (chunkInfo.done && !chunkInfo.error && !answer && !hasCharts) {
      logger.warn('POLL_FINAL_EMPTY', logFields(sysHeader, bizBody, {
        scene: scene || task.scene,
        agentId: agentId || task.agentId,
        seq: chunkInfo.seq,
        durationMs: task.createdAt ? Date.now() - task.createdAt : undefined,
      }));
      removeTask(streamId);
      return buildErrorResponse(sysHeader, bizBody, EMPTY_ANSWER_ERROR);
    }
    logger.info('POLL_FINAL_OK', logFields(sysHeader, bizBody, {
      scene: scene || task.scene,
      agentId: agentId || task.agentId,
      seq: chunkInfo.seq,
      answerLen: String(chunkInfo.answer || '').length,
      chartCount: Array.isArray(chunkInfo.echartdata) ? chunkInfo.echartdata.length : 0,
      durationMs: task.createdAt ? Date.now() - task.createdAt : undefined,
    }));
    removeTask(streamId);
  }
  return response;
}

function handleStartStreamRequest({ sysHeader, bizBody, agentId, scene, becauseBaseUrl }) {
  const conversationId = resolveConversationId(bizBody);
  const parentMessageId = resolveParentMessageId(bizBody);

  const { streamId } = createStreamTask({ agentId, scene, becauseBaseUrl });
  const context = logFields(sysHeader, bizBody, {
    scene,
    streamId,
    agentId,
    becauseBaseUrl,
  });
  logger.info('STREAM_CREATED', context);
  let metaLogged = false;

  chatStream({
    agentId,
    becauseBaseUrl,
    scene,
    text: appendQueryContextToText(bizBody.text, bizBody.queryContext),
    conversationId,
    parentMessageId,
    orgCode: bizBody.orgCode,
    userNum: bizBody.userNum,
    onDelta: (chunk, meta) => {
      appendChunk(streamId, chunk);
      markRunningMeta(streamId, meta || {});
      if (!metaLogged && meta?.conversationId) {
        metaLogged = true;
        logger.info('SSE_META', {
          ...context,
          conversationId: meta.conversationId,
          parentMessageId: meta.parentMessageId,
          title: meta.title,
        });
      }
    },
    onDone: (result) => {
      if (!result?.ok) {
        logger.error('SSE_ONDONE_ERROR', {
          ...context,
          conversationId: result?.conversationId || conversationId,
          error: result?.error,
        });
        markDone(streamId, {
          error: result?.error || 'Because 返回错误',
          conversationId: result?.conversationId || conversationId,
        });
      }
    },
    onEchartdata: (echartdata) => {
      setEchartdata(streamId, echartdata);
      logger.info('SSE_CHARTS', {
        ...context,
        chartCount: Array.isArray(echartdata) ? echartdata.length : undefined,
      });
    },
    onSimilarQuestions: (similarQuestions) => {
      setSimilarQuestions(streamId, similarQuestions);
      logger.info('SSE_SIMILAR_QUESTIONS', {
        ...context,
        similarCount: similarQuestions?.similar_indices?.length || 0,
        indexSourceCount: similarQuestions?.index_source?.length || 0,
      });
    },
    onAttributionData: (attributiondata) => {
      setAttributionData(streamId, attributiondata);
      logger.info('SSE_ATTRIBUTION', {
        ...context,
        indexCount: attributiondata?.indexName?.length || 0,
        orgCount: attributiondata?.orgCode?.length || 0,
        dataDate: attributiondata?.dataDate,
      });
    },
    // 工具调用期间可能持续有非文本 SSE 活动但长时间没有 chunk/扩展字段更新，
    // 单独刷新任务 TTL，避免长耗时归因任务被 cleanup 提前清掉。
    onActivity: () => touchTask(streamId),
  })
    .then((result) => {
      if (!result?.ok) {
        return;
      }
      finalizeStreamFromResult(streamId, result, {
        conversationId,
        parentMessageId,
        title: null,
        logContext: context,
      });
    })
    .catch((err) => {
      const { message, cause } = describeError(err);
      logger.error('CHAT_STREAM_ERROR', {
        ...context,
        message,
        cause,
      });
      markDone(streamId, {
        error: err.message || 'Because 调用异常',
        conversationId,
      });
    });

  const chunkInfo = readPollState(streamId, {
    maxChunkChars: config.streamPollBatchMaxChars,
  });
  if (!chunkInfo) {
    logger.error('STREAM_CREATE_FAILED', context);
    return buildErrorResponse(sysHeader, bizBody, '创建流任务失败');
  }
  logger.info('START_RESPONSE', {
    ...context,
    seq: chunkInfo.seq,
    isFinal: chunkInfo.isFinal ? 'Y' : 'N',
    chunkLen: String(chunkInfo.chunk || '').length,
  });
  return buildSuccessResponse(sysHeader, bizBody, buildStreamPayload(streamId, chunkInfo));
}

module.exports = {
  handleEsbTransaction,
  resolveAgentId,
};
