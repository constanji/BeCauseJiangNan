const express = require('express');
const { generateCheckAccess, skipAgentCheck } = require('@because/api');
const { PermissionTypes, Permissions, PermissionBits } = require('@because/data-provider');
const { logger } = require('@because/data-schemas');
const {
  setHeaders,
  moderateText,
  // validateModel,
  validateConvoAccess,
  buildEndpointOption,
  canAccessAgentFromBody,
} = require('~/server/middleware');
const { handleAbort } = require('~/server/middleware/abortMiddleware');
const { initializeClient } = require('~/server/services/Endpoints/agents');
const AgentController = require('~/server/controllers/agents/request');
const addTitle = require('~/server/services/Endpoints/agents/title');
const { getRoleByName } = require('~/models/Role');

const router = express.Router();

router.use(moderateText);

const checkAgentAccess = generateCheckAccess({
  permissionType: PermissionTypes.AGENTS,
  permissions: [Permissions.USE],
  skipCheck: skipAgentCheck,
  getRoleByName,
});
const checkAgentResourceAccess = canAccessAgentFromBody({
  requiredPermission: PermissionBits.VIEW,
});

router.use(checkAgentAccess);
router.use(checkAgentResourceAccess);
router.use(validateConvoAccess);
router.use(buildEndpointOption);
router.use(setHeaders);

const controller = async (req, res, next) => {
  try {
    await AgentController(req, res, next, initializeClient, addTitle);
    logger.info('[routes/agents/chat] 9.请求完成');
  } catch (error) {
    logger.error('[routes/agents/chat] 请求处理出错', error);
    throw error;
  }
};

/**
 * @route POST /abort
 * @desc Abort an ongoing agent conversation
 * @access Public
 */
router.post('/abort', handleAbort());

/**
 * @route POST / (regular endpoint)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/', controller);

/**
 * @route POST /:endpoint (ephemeral agents)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/:endpoint', controller);

module.exports = router;
