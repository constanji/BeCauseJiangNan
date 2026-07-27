const fs = require('fs');
const path = require('path');
const { logger } = require('@because/data-schemas');

const projectRoot = path.resolve(__dirname, '../../../..');

/** pluginKey → 技能包相对项目根目录的文件夹名 */
const TOOL_PACKAGE_MAP = {
  because_jn: 'Because-jn',
};

function resolvePackageDir(pluginKey) {
  const key = String(pluginKey || '').trim();
  const folder = TOOL_PACKAGE_MAP[key];
  if (!folder) {
    const err = new Error(`工具 ${key} 未配置提示词模板`);
    err.statusCode = 404;
    throw err;
  }
  return path.join(projectRoot, folder);
}

function loadRegistry(packageDir) {
  const registryPath = path.join(packageDir, 'prompt-templates.json');
  if (!fs.existsSync(registryPath)) {
    return [];
  }
  const raw = fs.readFileSync(registryPath, 'utf8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) {
    throw new Error('prompt-templates.json 格式无效');
  }
  return list;
}

function safeResolveTemplateFile(packageDir, relativeFile) {
  const file = String(relativeFile || '').trim();
  if (!file || file.includes('..') || path.isAbsolute(file)) {
    const err = new Error('非法模板路径');
    err.statusCode = 400;
    throw err;
  }
  const full = path.resolve(packageDir, file);
  const root = path.resolve(packageDir);
  if (!full.startsWith(root + path.sep) && full !== root) {
    const err = new Error('非法模板路径');
    err.statusCode = 400;
    throw err;
  }
  return full;
}

/**
 * 列出工具自带提示词模板（不含正文）
 * @param {string} pluginKey
 * @returns {{ id: string, label: string }[]}
 */
function listPromptTemplates(pluginKey) {
  const packageDir = resolvePackageDir(pluginKey);
  const registry = loadRegistry(packageDir);
  return registry
    .filter((t) => t && t.id && t.file)
    .map((t) => ({
      id: String(t.id),
      label: String(t.label || t.id),
    }));
}

/**
 * 读取单个模板正文
 * @param {string} pluginKey
 * @param {string} templateId
 * @returns {{ id: string, label: string, content: string }}
 */
function getPromptTemplate(pluginKey, templateId) {
  const packageDir = resolvePackageDir(pluginKey);
  const registry = loadRegistry(packageDir);
  const entry = registry.find((t) => t && String(t.id) === String(templateId));
  if (!entry) {
    const err = new Error(`模板不存在: ${templateId}`);
    err.statusCode = 404;
    throw err;
  }
  const filePath = safeResolveTemplateFile(packageDir, entry.file);
  if (!fs.existsSync(filePath)) {
    logger.warn(`[PromptTemplateService] 模板文件缺失: ${filePath}`);
    const err = new Error(`模板文件不存在: ${entry.file}`);
    err.statusCode = 404;
    throw err;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    id: String(entry.id),
    label: String(entry.label || entry.id),
    content,
  };
}

module.exports = {
  TOOL_PACKAGE_MAP,
  listPromptTemplates,
  getPromptTemplate,
};
