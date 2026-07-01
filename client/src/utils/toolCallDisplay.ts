const becauseSkillsCommandMap: Record<string, string> = {
  'database-schema': '获取数据库Schema',
  'intent-classification': '意图识别',
  'rag-retrieval': 'RAG检索',
  'sql-validation': 'SQL语句验证',
  'sql-executor': 'SQL执行',
  'result-analysis': '归因调查',
  'chart-generation': '可视化图表生成',
  'reranker': '结果重排序',
  'fluctuation-attribution': '波动归因分析',
  'light-schema': 'Light Schema 检索',
  'knowledge-discovery': '知识发现',
  'cell-vectorization': '单元格向量化',
};

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
