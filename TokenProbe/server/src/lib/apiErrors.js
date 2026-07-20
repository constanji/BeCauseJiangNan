const ApiError = {
  UNAUTHORIZED: '未授权：请填写正确的访问密钥（TOKEN_PROBE_SECRET）',
  NOT_FOUND: '未找到对应记录',
  CONNECTION_NOT_FOUND: '未找到该 BeCause 连接',
  TASK_NOT_FOUND: '未找到该任务',
  REPORT_NOT_FOUND: '未找到该报告',
  FIELDS_REQUIRED: '请填写必填字段',
  TASK_IDS_REQUIRED: '请提供要删除的报告列表',
  CONVERSATION_REQUIRED: '请提供 conversationId 或填写问句以真跑采集',
};

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function notFound(res, error = ApiError.NOT_FOUND) {
  return fail(res, 404, error);
}

function badRequest(res, error) {
  return fail(res, 400, error);
}

function unauthorized(res, error = ApiError.UNAUTHORIZED) {
  return fail(res, 401, error);
}

module.exports = {
  ApiError,
  fail,
  notFound,
  badRequest,
  unauthorized,
};
