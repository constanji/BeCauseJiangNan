const { logger } = require('@because/data-schemas');
const { SystemRoles } = require('@because/data-provider');
const { User } = require('~/db/models');
const { getAllUserMemories } = require('~/models');
const {
  deleteAllUserSessions,
  deleteAllSharedLinks,
  deleteUserById,
  deleteMessages,
  deletePresets,
  deleteConvos,
  deleteFiles,
  updateUser,
} = require('~/models');
const {
  ConversationTag,
  Transaction,
  MemoryEntry,
  Assistant,
  AclEntry,
  Balance,
  Action,
  Group,
  Token,
} = require('~/db/models');
const { deleteUserPluginAuth } = require('~/server/services/PluginService');
const { deleteUserKey } = require('~/server/services/UserService');
const { deleteToolCalls } = require('~/models/ToolCall');
const { deleteUserPrompts } = require('~/models/Prompt');
const { deleteUserAgents } = require('~/models/Agent');

// 检查是否为管理员
function checkAdmin(req, res, next) {
  if (req.user?.role !== SystemRoles.ADMIN) {
    return res.status(403).json({ error: '只有管理员可以执行此操作' });
  }
  next();
}

// 删除指定用户（管理员）
async function deleteUserByIdController(req, res) {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: '用户ID不能为空' });
    }

    // 不能删除自己
    if (req.user.id === userId) {
      return res.status(400).json({ error: '不能删除自己的账户' });
    }

    // 查找用户
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 删除用户的所有数据
    await deleteMessages({ user: userId });
    await deleteAllUserSessions({ userId });
    await Transaction.deleteMany({ user: userId });
    await deleteUserKey({ userId, all: true });
    await Balance.deleteMany({ user: userId });
    await deletePresets(userId);
    try {
      await deleteConvos(userId);
    } catch (error) {
      logger.error('[deleteUserByIdController] Error deleting user convos', error);
    }
    await deleteUserPluginAuth(userId, null, true);
    await deleteAllSharedLinks(userId);
    await deleteFiles(null, userId);
    await deleteToolCalls(userId);
    await deleteUserAgents(userId);
    await Assistant.deleteMany({ user: userId });
    await ConversationTag.deleteMany({ user: userId });
    await MemoryEntry.deleteMany({ userId });
    await deleteUserPrompts({ user: { id: userId } }, userId);
    await Action.deleteMany({ user: userId });
    await Token.deleteMany({ userId });
    await Group.updateMany(
      { memberIds: userId },
      { $pull: { memberIds: userId } },
    );
    await AclEntry.deleteMany({ principalId: userId });

    // 删除用户
    await deleteUserById(userId);

    logger.info(`Admin deleted user. Email: ${targetUser.email} ID: ${userId}`);
    res.status(200).json({ message: '用户已成功删除', user: { id: userId, email: targetUser.email } });
  } catch (error) {
    logger.error('[deleteUserByIdController]', error);
    res.status(500).json({ error: error.message || '删除用户失败' });
  }
}

// 更新用户角色（管理员）
async function updateUserRoleController(req, res) {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!userId) {
      return res.status(400).json({ error: '用户ID不能为空' });
    }

    if (!role || !['ADMIN', 'USER'].includes(role)) {
      return res.status(400).json({ error: '角色必须是 ADMIN 或 USER' });
    }

    // 不能修改自己的角色
    if (req.user.id === userId && role !== SystemRoles.ADMIN) {
      return res.status(400).json({ error: '不能将自己的角色修改为非管理员' });
    }

    // 查找并更新用户
    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true, runValidators: true }
    ).select('_id email username name avatar provider role orgCode createdAt updatedAt');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    logger.info(`Admin updated user role. User: ${user.email} New role: ${role}`);
    res.status(200).json({ 
      message: '用户角色已更新',
      user: {
        _id: user._id.toString(),
        email: user.email,
        username: user.username,
        name: user.name,
        avatar: user.avatar,
        provider: user.provider,
        role: user.role,
        orgCode: user.orgCode || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }
    });
  } catch (error) {
    logger.error('[updateUserRoleController]', error);
    res.status(500).json({ error: error.message || '更新用户角色失败' });
  }
}

// 获取指定用户的记忆（管理员）
async function getUserMemoriesController(req, res) {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: '用户ID不能为空' });
    }

    // 查找用户
    const targetUser = await User.findById(userId).select('_id email username name');
    if (!targetUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 获取用户记忆
    const memories = await getAllUserMemories(userId);

    const sortedMemories = memories.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    const totalTokens = memories.reduce((sum, memory) => {
      return sum + (memory.tokenCount || 0);
    }, 0);

    res.setHeader('Content-Type', 'application/json');
    res.json({
      success: true,
      userId: targetUser._id.toString(),
      userEmail: targetUser.email,
      userName: targetUser.name || targetUser.username || targetUser.email,
      memories: sortedMemories,
      totalTokens,
      count: memories.length,
    });
  } catch (error) {
    logger.error('[getUserMemoriesController]', error);
    res.status(500).json({ error: error.message || '获取用户记忆失败' });
  }
}


// 更新用户机构编码（管理员）
async function updateUserOrgCodeController(req, res) {
  try {
    const { userId } = req.params;
    const raw = req.body?.orgCode;

    if (!userId) {
      return res.status(400).json({ error: '用户ID不能为空' });
    }

    // 空字符串 / null 视为清空机构绑定
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    const update = trimmed
      ? { orgCode: trimmed }
      : { $unset: { orgCode: 1 } };

    const user = await User.findByIdAndUpdate(userId, update, {
      new: true,
      runValidators: true,
    }).select('_id email username name avatar provider role orgCode createdAt updatedAt');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    logger.info(
      `Admin updated user orgCode. User: ${user.email} orgCode: ${user.orgCode || '(已清空)'}`,
    );
    res.status(200).json({
      message: trimmed ? '用户机构已更新' : '已清空用户机构',
      user: {
        _id: user._id.toString(),
        email: user.email,
        username: user.username,
        name: user.name,
        avatar: user.avatar,
        provider: user.provider,
        role: user.role,
        orgCode: user.orgCode || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    logger.error('[updateUserOrgCodeController]', error);
    res.status(500).json({ error: error.message || '更新用户机构失败' });
  }
}

module.exports = {
  checkAdmin,
  deleteUserByIdController,
  updateUserRoleController,
  updateUserOrgCodeController,
  getUserMemoriesController,
};

