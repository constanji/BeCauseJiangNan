const { SystemRoles } = require('@because/data-provider');
const { logger } = require('@because/data-schemas');

/**
 * OpenClaw 系统服务账户用户对象
 * 当 OpenClaw 通过静态 token 认证时，使用此用户身份
 */
// 固定的 OpenClaw 服务账户 ObjectId（'openclaw_svc' 的十六进制编码，24位合法 ObjectId）
const OPENCLAW_USER_ID = '6f70656e636c61775f737663';

const OPENCLAW_USER = Object.freeze({
  id: OPENCLAW_USER_ID,
  _id: OPENCLAW_USER_ID,
  username: 'openclaw',
  name: 'OpenClaw Service',
  role: SystemRoles.ADMIN,
  provider: 'openclaw',
});

/**
 * 从请求的 Authorization header 中提取 Bearer token
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * 检查请求是否携带有效的 OpenClaw token
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isOpenclawRequest(req) {
  const openclawToken = process.env.OPENCLAW_TOKEN;
  if (!openclawToken) {
    return false;
  }

  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return false;
  }

  return bearerToken === openclawToken;
}

/**
 * 尝试以 OpenClaw token 认证请求
 * 如果认证成功，设置 req.user 并返回 true
 * @param {import('express').Request} req
 * @returns {boolean} 是否认证成功
 */
function tryOpenclawAuth(req) {
  if (isOpenclawRequest(req)) {
    req.user = { ...OPENCLAW_USER };
    req.isOpenclawRequest = true;
    logger.debug('[openclawAuth] OpenClaw service authenticated');
    return true;
  }
  return false;
}

module.exports = {
  OPENCLAW_USER,
  isOpenclawRequest,
  tryOpenclawAuth,
};
