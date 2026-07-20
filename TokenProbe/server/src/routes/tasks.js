const express = require('express');
const { ApiError, badRequest, notFound } = require('../lib/apiErrors');
const { startTask, getTaskSnapshot } = require('../services/TaskOrchestrator');

const router = express.Router();

router.post('/run', (req, res) => {
  const { connectionId, question, conversationId, agentId, dataSourceId, mode } = req.body || {};
  if (!connectionId) return badRequest(res, '请选择 BeCause 连接');
  if (!conversationId && !question) {
    return badRequest(res, ApiError.CONVERSATION_REQUIRED);
  }
  const taskId = startTask({
    connectionId: Number(connectionId),
    config: {
      mode: mode || (conversationId && !question ? 'attach' : 'live'),
      question: question || null,
      conversationId: conversationId || null,
      agentId: agentId || null,
      dataSourceId: dataSourceId || null,
    },
  });
  return res.json({ success: true, taskId });
});

router.get('/task/:taskId', (req, res) => {
  const snap = getTaskSnapshot(req.params.taskId);
  if (!snap) return notFound(res, ApiError.TASK_NOT_FOUND);
  return res.json({ success: true, data: snap });
});

module.exports = router;
