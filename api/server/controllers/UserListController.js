const { logger } = require('@because/data-schemas');
const { SystemRoles } = require('@because/data-provider');
const { User } = require('~/db/models');
const { requireJwtAuth } = require('~/server/middleware');

// 获取用户列表（仅管理员）
async function getUserListController(req, res) {
  try {
    // 检查用户是否为管理员
    if (req.user?.role !== SystemRoles.ADMIN) {
      return res.status(403).json({ error: '只有管理员可以访问用户列表' });
    }

    // 查询所有用户，排除敏感信息
    const users = await User.find(
      {},
      {
        _id: 1,
        email: 1,
        username: 1,
        name: 1,
        avatar: 1,
        provider: 1,
        role: 1,
        orgCode: 1,
        createdAt: 1,
        updatedAt: 1,
      }
    )
      .sort({ createdAt: -1 })
      .lean();

    res.setHeader('Content-Type', 'application/json');
    res.json({ users });
  } catch (error) {
    logger.error('Error fetching user list:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch user list' });
  }
}

module.exports = getUserListController;

