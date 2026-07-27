const express = require('express');
const { callTool, verifyToolAuth, getToolCalls } = require('~/server/controllers/tools');
const { getAvailableTools } = require('~/server/controllers/PluginController');
const { toolCallLimiter } = require('~/server/middleware');
const {
  listPromptTemplates,
  getPromptTemplate,
} = require('~/server/services/Tools/PromptTemplateService');
const { logger } = require('@because/data-schemas');

const router = express.Router();

/**
 * Get a list of available tools for agents.
 * @route GET /agents/tools
 * @returns {TPlugin[]} 200 - application/json
 */
router.get('/', getAvailableTools);

/**
 * Get a list of tool calls.
 * @route GET /agents/tools/calls
 * @returns {ToolCallData[]} 200 - application/json
 */
router.get('/calls', getToolCalls);

/**
 * List prompt templates bundled with a tool package.
 * @route GET /agents/tools/:toolId/prompt-templates
 */
router.get('/:toolId/prompt-templates', (req, res) => {
  try {
    const list = listPromptTemplates(req.params.toolId);
    res.json({ success: true, data: list });
  } catch (error) {
    logger.warn(`[agents/tools/prompt-templates] ${error.message}`);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get one prompt template content.
 * @route GET /agents/tools/:toolId/prompt-templates/:templateId
 */
router.get('/:toolId/prompt-templates/:templateId', (req, res) => {
  try {
    const data = getPromptTemplate(req.params.toolId, req.params.templateId);
    res.json({ success: true, data });
  } catch (error) {
    logger.warn(`[agents/tools/prompt-templates/:id] ${error.message}`);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Verify authentication for a specific tool
 * @route GET /agents/tools/:toolId/auth
 * @param {string} toolId - The ID of the tool to verify
 * @returns {{ authenticated?: boolean; message?: string }}
 */
router.get('/:toolId/auth', verifyToolAuth);

/**
 * Execute code for a specific tool
 * @route POST /agents/tools/:toolId/call
 * @param {string} toolId - The ID of the tool to execute
 * @param {object} req.body - Request body
 * @returns {object} Result of code execution
 */
router.post('/:toolId/call', toolCallLimiter, callTool);

module.exports = router;
