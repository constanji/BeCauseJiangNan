/**
 * DatProject Controller
 * 
 * DAT 项目管理的 CRUD 操作控制器
 */
const { logger } = require('@because/data-schemas');
const { extractEnvVariable } = require('@because/data-provider');
const { getDatProjectModel } = require('~/models/DatProject');

/**
 * 递归解析配置中的 ${ENV} 占位，写入 DAT 前展开为真实值
 */
function resolveEnvDeep(value) {
    if (typeof value === 'string') {
        return extractEnvVariable(value);
    }
    if (Array.isArray(value)) {
        return value.map(resolveEnvDeep);
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = resolveEnvDeep(v);
        }
        return out;
    }
    return value;
}

function prepareProjectPayload(projectData) {
    if (!projectData || typeof projectData !== 'object') {
        return projectData;
    }
    const payload = { ...projectData };
    if (Array.isArray(payload.llms)) {
        payload.llms = payload.llms.map((llm) => ({
            ...llm,
            configuration: resolveEnvDeep(llm.configuration || {}),
        }));
    }
    return payload;
}

/**
 * 获取所有项目列表
 */
async function getProjects(req, res) {
    try {
        const DatProject = await getDatProjectModel();
        const projects = await DatProject.find({})
            .sort({ updatedAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            projects,
        });
    } catch (error) {
        logger.error('[GET /api/dat-projects] Error:', error);
        return res.status(500).json({
            error: error.message || 'Failed to fetch projects',
        });
    }
}

/**
 * 获取单个项目详情
 */
async function getProject(req, res) {
    try {
        const { id } = req.params;
        const DatProject = await getDatProjectModel();
        const project = await DatProject.findById(id).lean();

        if (!project) {
            return res.status(404).json({
                error: 'Project not found',
            });
        }

        return res.status(200).json({
            success: true,
            project,
        });
    } catch (error) {
        logger.error(`[GET /api/dat-projects/${req.params.id}] Error:`, error);
        return res.status(500).json({
            error: error.message || 'Failed to fetch project',
        });
    }
}

/**
 * 创建新项目
 */
async function createProject(req, res) {
    try {
        const projectData = req.body;

        if (!projectData.name) {
            return res.status(400).json({
                error: 'Project name is required',
            });
        }

        const DatProject = await getDatProjectModel();

        // 检查项目名称是否已存在
        const existing = await DatProject.findOne({ name: projectData.name });
        if (existing) {
            return res.status(409).json({
                error: `Project with name "${projectData.name}" already exists`,
            });
        }

        const project = new DatProject(prepareProjectPayload(projectData));
        await project.save();

        logger.info(`[POST /api/dat-projects] Created project: ${project.name}`);

        return res.status(201).json({
            success: true,
            project: project.toObject(),
        });
    } catch (error) {
        logger.error('[POST /api/dat-projects] Error:', error);
        return res.status(500).json({
            error: error.message || 'Failed to create project',
        });
    }
}

/**
 * 更新项目
 */
async function updateProject(req, res) {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const DatProject = await getDatProjectModel();

        // 如果更新了名称，检查新名称是否与其他项目冲突
        if (updateData.name) {
            const existing = await DatProject.findOne({
                name: updateData.name,
                _id: { $ne: id },
            });
            if (existing) {
                return res.status(409).json({
                    error: `Project with name "${updateData.name}" already exists`,
                });
            }
        }

        const project = await DatProject.findByIdAndUpdate(
            id,
            prepareProjectPayload(updateData),
            { new: true, runValidators: true }
        ).lean();

        if (!project) {
            return res.status(404).json({
                error: 'Project not found',
            });
        }

        logger.info(`[PUT /api/dat-projects/${id}] Updated project: ${project.name}`);

        return res.status(200).json({
            success: true,
            project,
        });
    } catch (error) {
        logger.error(`[PUT /api/dat-projects/${req.params.id}] Error:`, error);
        return res.status(500).json({
            error: error.message || 'Failed to update project',
        });
    }
}

/**
 * 删除项目
 */
async function deleteProject(req, res) {
    try {
        const { id } = req.params;
        const DatProject = await getDatProjectModel();
        const project = await DatProject.findByIdAndDelete(id);

        if (!project) {
            return res.status(404).json({
                error: 'Project not found',
            });
        }

        logger.info(`[DELETE /api/dat-projects/${id}] Deleted project: ${project.name}`);

        return res.status(200).json({
            success: true,
            message: `Project "${project.name}" deleted successfully`,
        });
    } catch (error) {
        logger.error(`[DELETE /api/dat-projects/${req.params.id}] Error:`, error);
        return res.status(500).json({
            error: error.message || 'Failed to delete project',
        });
    }
}

module.exports = {
    getProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
};
