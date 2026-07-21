const becauseSkillsCommandMap: Record<string, string> = {
  'database-schema': '检查数据库Schema',
  'intent-classification': '意图识别',
  'rag-retrieval': 'RAG检索',
  'sql-validation': 'SQL语句验证',
  'sql-executor': 'SQL执行',
  'result-analysis': '归因调查',
  'chart-generation': '可视化图表生成',
  'reranker': '结果重排序',
  'fluctuation-attribution': '整理数据归因',
  'light-schema': '获取数据表结构',
  'knowledge-discovery': '业务理解',
  'cell-vectorization': '单元格向量化',
};

export const BECAUSE_SKILLS_TOOL_NAMES = new Set([
  'because_skills',
  'because_skills_2',
  'because_skills_3',
]);

export function isBeCauseSkillsToolName(name?: string | null): boolean {
  return !!name && BECAUSE_SKILLS_TOOL_NAMES.has(name);
}

export function mapBecauseSkillsCommand(command?: string | null): string | null {
  if (!command || typeof command !== 'string') {
    return null;
  }
  return becauseSkillsCommandMap[command] || command;
}

export function extractBecauseSkillsCommand(
  source: string | Record<string, unknown> | null | undefined,
): string | null {
  if (!source) return null;

  if (typeof source === 'object') {
    const command = source.command;
    return typeof command === 'string' && command.length > 0 ? mapBecauseSkillsCommand(command) : null;
  }

  if (typeof source !== 'string' || source.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(source);
    const command = parsed?.command;
    if (typeof command === 'string' && command.length > 0) {
      return mapBecauseSkillsCommand(command);
    }
  } catch {
    // 流式阶段常常是半截 JSON，继续走正则兜底
  }

  const patterns = [
    /"command"\s*:\s*"([^"]+)"/,
    /'command'\s*:\s*'([^']+)'/,
    /"command"\s*:\s*([^,}\s]+)/,
    /"command"\s*:\s*"([^"]*)/,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const command = match?.[1]?.replace(/^["']|["']$/g, '');
    if (command && command.length >= 3) {
      return mapBecauseSkillsCommand(command);
    }
  }

  return null;
}

const standaloneToolNameMap: Record<string, string> = {
  echarts_generator_app: 'ECharts 图表生成',
  generate_excel: '生成 Excel',
};

export function mapStandaloneToolName(name?: string | null): string | null {
  if (!name || typeof name !== 'string') {
    return null;
  }
  return standaloneToolNameMap[name] || null;
}

/**
 * 判断工具输出内容是否代表业务失败（success: false），而非执行层异常。
 * 很多结构化工具即使业务失败也不会抛异常，只会返回 { success: false, error: "..." }，
 * 这类输出不应该被误判为成功（绿勾）。
 */
function hasExplicitSuccessFalse(source: string): boolean {
  try {
    const parsed = JSON.parse(source);
    return !!(parsed && typeof parsed === 'object' && parsed.success === false);
  } catch {
    // 流式/截断阶段可能拿到不完整 JSON，用正则兜底匹配顶层 success 字段
    const match = source.match(/^\s*\{[\s\S]*?"success"\s*:\s*(true|false)/);
    return match ? match[1] === 'false' : false;
  }
}

/**
 * 统一判断工具调用结果是否应展示为「失败」（红叉），
 * 覆盖两类情况：执行层异常（"error processing tool ..." 文案）与业务层失败（success: false）。
 */
export function isToolOutputError(output?: string | null): boolean {
  if (typeof output !== 'string' || output.length === 0) {
    return false;
  }
  if (output.toLowerCase().includes('error processing tool')) {
    return true;
  }
  return hasExplicitSuccessFalse(output);
}

const toolErrorCategoryLabelMap: Record<string, string> = {
  SQL_POLICY: 'SQL策略拒绝',
  DATASOURCE_CONFIG: '数据源配置',
  CONNECTION: '连接失败',
  AUTH: '认证失败',
  SQL_SYNTAX: 'SQL语法错误',
  SQL_SEMANTIC: '表/字段错误',
  TIMEOUT: '查询超时',
  PERMISSION: '权限不足',
  UNKNOWN: '执行失败',
};

export type StructuredToolFailure = {
  error: string;
  code?: string;
  category?: string;
  categoryLabel?: string;
  hint?: string;
};

/**
 * 解析结构化工具失败（success:false + error/code/category/hint），供 UI 展示。
 */
export function parseStructuredToolFailure(output?: string | null): StructuredToolFailure | null {
  if (typeof output !== 'string' || output.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(output);
    if (!parsed || typeof parsed !== 'object' || parsed.success !== false) {
      return null;
    }
    const error = typeof parsed.error === 'string' ? parsed.error : '';
    if (!error) {
      return null;
    }
    const category = typeof parsed.category === 'string' ? parsed.category : undefined;
    return {
      error,
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      category,
      categoryLabel: category ? toolErrorCategoryLabelMap[category] || category : undefined,
      hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
    };
  } catch {
    return null;
  }
}

/** 一行可读的失败摘要：【类别】错误。提示 */
export function formatToolFailureSummary(output?: string | null): string | null {
  const failure = parseStructuredToolFailure(output);
  if (!failure) {
    return null;
  }
  const parts: string[] = [];
  if (failure.categoryLabel) {
    parts.push(`【${failure.categoryLabel}】${failure.error}`);
  } else {
    parts.push(failure.error);
  }
  if (failure.hint) {
    parts.push(failure.hint);
  }
  return parts.join('。');
}
