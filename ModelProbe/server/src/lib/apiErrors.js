/**
 * 管理端 API 统一中文错误文案与响应助手。
 */

const ApiError = {
  UNAUTHORIZED: '未授权：请填写正确的访问密钥（MODEL_PROBE_SECRET）',
  NOT_FOUND: '未找到对应记录',
  ENDPOINT_NOT_FOUND: '未找到该端点',
  TASK_NOT_FOUND: '未找到该探测任务',
  REPORT_NOT_FOUND: '未找到该报告',
  MODEL_REQUIRED: '请填写模型名称',
  ENDPOINT_AND_MODEL_REQUIRED: '请选择端点并填写模型名称',
  ENDPOINT_FIELDS_REQUIRED: '请填写名称、服务地址（Base URL）和 API Key',
  TASK_IDS_REQUIRED: '请提供要删除的报告列表',
  IMPORT_ENDPOINT_FORBIDDEN: '系统占位端点不可复制',
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
