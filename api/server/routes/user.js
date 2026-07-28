const express = require('express');
const {
  updateUserPluginsController,
  resendVerificationController,
  getTermsStatusController,
  acceptTermsController,
  verifyEmailController,
  deleteUserController,
  getUserController,
} = require('~/server/controllers/UserController');
const getUserListController = require('~/server/controllers/UserListController');
const {
  deleteUserByIdController,
  updateUserRoleController,
  updateUserOrgCodeController,
  getUserMemoriesController,
  checkAdmin,
} = require('~/server/controllers/AdminUserController');
const {
  verifyEmailLimiter,
  configMiddleware,
  canDeleteAccount,
  requireJwtAuth,
} = require('~/server/middleware');

const router = express.Router();

router.get('/', requireJwtAuth, getUserController);
router.get('/list', requireJwtAuth, getUserListController);
router.get('/terms', requireJwtAuth, getTermsStatusController);
router.post('/terms/accept', requireJwtAuth, acceptTermsController);
router.post('/plugins', requireJwtAuth, updateUserPluginsController);
router.delete('/delete', requireJwtAuth, canDeleteAccount, configMiddleware, deleteUserController);
router.post('/verify', verifyEmailController);
router.post('/verify/resend', verifyEmailLimiter, resendVerificationController);

// 管理员用户管理路由
router.delete('/:userId', requireJwtAuth, checkAdmin, deleteUserByIdController);
router.patch('/:userId/role', requireJwtAuth, checkAdmin, updateUserRoleController);
router.patch('/:userId/orgCode', requireJwtAuth, checkAdmin, updateUserOrgCodeController);
router.get('/:userId/memories', requireJwtAuth, checkAdmin, getUserMemoriesController);

module.exports = router;
