/**
 * DAT Projects Routes
 * 
 * 项目管理 API 路由
 */
const express = require('express');
const {
    getProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
} = require('~/server/controllers/DatProjectController');

const router = express.Router();

// 获取所有项目
router.get('/', getProjects);

// 获取单个项目
router.get('/:id', getProject);

// 创建项目
router.post('/', createProject);

// 更新项目
router.put('/:id', updateProject);

// 删除项目
router.delete('/:id', deleteProject);

module.exports = router;
