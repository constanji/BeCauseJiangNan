/**
 * 维度下钻可执行提示（filter / sql_hint）生成
 * 供 fluctuation-attribution、result-analysis 共用
 */

function escapeSqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && !isNaN(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 从 drillPath.steps 生成 WHERE 过滤条件
 */
function buildFilterFromPath(steps) {
  if (!steps || steps.length === 0) return null;

  const clauses = steps
    .filter((s) => s.dimension && s.value !== undefined && s.value !== null)
    .map((s) => `${s.dimension} = ${escapeSqlValue(s.value)}`);

  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

/**
 * 生成下钻 SQL 提示
 */
function buildSqlHint({ metricField, steps, table }) {
  if (!metricField || !steps || steps.length === 0) return null;

  const filter = buildFilterFromPath(steps);
  const groupDims = [...new Set(steps.map((s) => s.dimension).filter(Boolean))];
  const fromClause = table ? `FROM ${table}` : 'FROM <表名>';

  if (groupDims.length > 0) {
    const selectCols = [...groupDims, `SUM(${metricField}) AS ${metricField}`].join(', ');
    const whereClause = filter ? ` WHERE ${filter}` : '';
    return `SELECT ${selectCols} ${fromClause}${whereClause} GROUP BY ${groupDims.join(', ')}`;
  }

  if (filter) {
    return `SELECT * ${fromClause} WHERE ${filter}`;
  }

  return null;
}

/**
 * 基于维度归因结果生成带 sql_hint / filter 的后续步骤
 */
function buildDrillDownNextSteps(dimensionAttribution, metricField, options = {}) {
  const steps = [];
  if (!dimensionAttribution) return steps;

  const { table } = options;

  if (dimensionAttribution.dimensionRanking?.length > 0) {
    const top = dimensionAttribution.dimensionRanking[0];
    if (top.surprise > 0.05) {
      steps.push({
        action: `深入分析"${top.dimension}"维度的分布变化`,
        question: `"${top.dimension}"维度为何出现显著分布变化？`,
        reason: `该维度惊喜度较高(${top.surprise.toFixed(4)})，分布发生了显著结构性变化`,
        sql_hint: `SELECT ${top.dimension}, SUM(${metricField}) AS ${metricField} FROM ${table || '<表名>'} GROUP BY ${top.dimension}`,
        filter: null,
        priority: 'high',
      });
    }
  }

  if (dimensionAttribution.drillPaths?.length > 0) {
    const topPath = dimensionAttribution.drillPaths[0];
    const filter = buildFilterFromPath(topPath.steps);
    const sqlHint = buildSqlHint({ metricField, steps: topPath.steps, table });
    const pathLabel = topPath.steps.map((s) => `${s.dimension}="${s.value}"`).join(' → ');

    steps.push({
      action: '沿最显著归因路径进一步下钻',
      question: `路径 ${pathLabel} 对指标变化的贡献原因是什么？`,
      reason: `累计解释力约 ${topPath.cumulativeExplanation}%，共发现 ${dimensionAttribution.drillPaths.length} 条归因路径`,
      sql_hint: sqlHint,
      filter,
      priority: 'high',
    });
  }

  if (dimensionAttribution.dimensionRanking?.length > 0) {
    const top = dimensionAttribution.dimensionRanking[0];
    const existing = steps.some((s) => s.sql_hint?.includes(`GROUP BY ${top.dimension}`));
    if (!existing && top.topContributors?.length > 0) {
      const topVal = top.topContributors[0].value;
      steps.push({
        action: `查看"${top.dimension}"维度中贡献最大的取值`,
        question: `为何 "${topVal}" 在 "${top.dimension}" 维度贡献最大？`,
        reason: `Adtributor评分 ${top.adtributorScore}，贡献率 ${top.topContributors[0].contributionRate}`,
        sql_hint: `SELECT * FROM ${table || '<表名>'} WHERE ${top.dimension} = ${escapeSqlValue(topVal)}`,
        filter: `${top.dimension} = ${escapeSqlValue(topVal)}`,
        priority: 'medium',
      });
    }
  }

  return steps;
}

/**
 * 从维度归因生成 follow_up_suggestions（result-analysis 格式）
 */
function buildFollowUpSuggestions(report, metricField) {
  const suggestions = [];
  const dimAttr = report.dimension_attribution;

  if (dimAttr?.dimensionRanking?.length > 0) {
    const top = dimAttr.dimensionRanking[0];
    suggestions.push({
      type: 'attribution',
      question: `"${top.dimension}"维度是否为主要波动来源？`,
      reason: `Adtributor评分=${top.adtributorScore}，解释力=${top.explanatoryPower}`,
      sql_hint: `SELECT ${top.dimension}, SUM(${metricField}) AS ${metricField} FROM <表名> GROUP BY ${top.dimension}`,
      priority: 'high',
    });
  }

  const drillSteps = buildDrillDownNextSteps(dimAttr, metricField);
  for (const step of drillSteps) {
    if (step.filter || step.sql_hint) {
      suggestions.push({
        type: 'drill_down',
        question: step.question || step.action,
        reason: step.reason,
        sql_hint: step.sql_hint,
        filter: step.filter,
        priority: step.priority,
      });
    }
  }

  return suggestions;
}

/**
 * 从分析报告生成 key_insights
 */
function generateKeyInsights(report, columnTypes, results) {
  const insights = [];

  if (report.dimension_attribution?.dimensionRanking?.length > 0) {
    const top = report.dimension_attribution.dimensionRanking[0];
    insights.push({
      type: 'attribution',
      dimension: top.dimension,
      value: `Adtributor评分=${top.adtributorScore}（EP=${top.explanatoryPower}, Surprise=${top.surprise}）`,
      impact: '该维度是最主要的归因维度',
      importance: 'high',
    });

    if (top.topContributors?.length > 0) {
      const tc = top.topContributors[0];
      insights.push({
        type: 'attribution_detail',
        dimension: `${top.dimension}=${tc.value}`,
        value: `贡献率 ${tc.contributionRate}，变化 ${tc.changeRate || tc.change}`,
        impact: '该维度取值对整体波动贡献最大',
        importance: 'high',
      });
    }
  }

  if (report.dimension_attribution?.drillPaths?.length > 0) {
    const path = report.dimension_attribution.drillPaths[0];
    insights.push({
      type: 'drill_path',
      dimension: path.steps.map((s) => s.dimension).join(' → '),
      value: path.steps.map((s) => `${s.dimension}="${s.value}"`).join(' → '),
      impact: `累计解释力约 ${path.cumulativeExplanation}%`,
      importance: 'high',
    });
  }

  if (report.anomaly_detection) {
    for (const [col, info] of Object.entries(report.anomaly_detection)) {
      if (info.outlier_count > 0) {
        insights.push({
          type: 'anomaly',
          dimension: col,
          value: `${info.outlier_count} 个异常值（IQR）`,
          impact: `正常范围 [${info.bounds.lower}, ${info.bounds.upper}]`,
          importance: 'high',
        });
        break;
      }
    }
  }

  if (report.time_trend) {
    for (const [col, trend] of Object.entries(report.time_trend)) {
      if (trend.strength === 'strong') {
        insights.push({
          type: 'trend',
          dimension: col,
          value: `${trend.direction} 趋势 (R²=${trend.rSquared})`,
          impact: `趋势强度: ${trend.strength}`,
          importance: trend.direction === 'decreasing' ? 'high' : 'medium',
        });
        break;
      }
    }
  }

  if (insights.length === 0 && columnTypes?.numeric?.length > 0 && results?.length > 0) {
    const field = columnTypes.numeric[0];
    const values = results.map((r) => Number(r[field])).filter((v) => !isNaN(v));
    if (values.length > 0) {
      const sum = values.reduce((a, b) => a + b, 0);
      insights.push({
        type: 'basic_stat',
        dimension: field,
        value: `样本 ${values.length} 条，合计 ${sum.toFixed(2)}`,
        impact: `范围 ${Math.min(...values)} ~ ${Math.max(...values)}`,
        importance: 'low',
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return insights.sort((a, b) => (order[a.importance] ?? 2) - (order[b.importance] ?? 2));
}

/**
 * 计算分析置信度（0–0.95）
 */
function calculateAnalysisConfidence(results, depth, extra = {}) {
  if (!results || results.length === 0) return 0;

  let confidence = 0.5;

  if (results.length >= 100) confidence += 0.2;
  else if (results.length >= 20) confidence += 0.15;
  else if (results.length >= 5) confidence += 0.1;

  if (depth === 'deep') confidence += 0.15;
  else if (depth === 'standard') confidence += 0.1;

  const columns = results.length > 0 ? Object.keys(results[0]).length : 0;
  if (columns >= 3) confidence += 0.05;

  if (extra.hasComparison) confidence += 0.05;
  if (extra.hasDimensionAttribution) confidence += 0.1;

  return Number(Math.min(0.95, confidence).toFixed(2));
}

/**
 * 结构化归因（加法/乘法/除法）后续步骤与 sql_hint
 */
function buildStructuredAttributionNextSteps(structuredAttribution, metricField) {
  const steps = [];
  if (!structuredAttribution) return steps;

  if (structuredAttribution.type === 'multiplicative' && structuredAttribution.topContributor) {
    const factor = structuredAttribution.topContributor.metric;
    steps.push({
      action: `下钻分析乘法因子「${factor}」的构成变化`,
      question: `为何 ${factor} 对 ${structuredAttribution.targetMetric || metricField} 贡献最大？`,
      reason: `链式分解显示 ${factor} 贡献 ${structuredAttribution.topContributor.contribution}`,
      sql_hint: `SELECT <时间维度>, ${factor}, SUM(${metricField}) AS ${metricField} FROM <表名> GROUP BY <时间维度>, ${factor}`,
      filter: null,
      priority: 'high',
    });
  }

  if (structuredAttribution.type === 'divisive') {
    const num = structuredAttribution.numerator_field;
    const den = structuredAttribution.denominator_field;
    const drillDims = structuredAttribution.recommended_drill_dimensions || ['user_cohort'];
    const dim = drillDims[0];
    steps.push({
      action: `按「${dim}」分层验证稀释效应（新/老用户）`,
      question: '转化率下降是否由低质量拉新导致分母扩张？',
      reason: `除法归因主因: ${structuredAttribution.primary_driver === 'denominator' ? '分母稀释' : '分子变化'}`,
      sql_hint: `SELECT ${dim}, SUM(${num}) AS ${num}, SUM(${den}) AS ${den}, SUM(${num})/NULLIF(SUM(${den}),0) AS rate FROM <表名> GROUP BY ${dim}`,
      filter: null,
      priority: 'high',
    });
  }

  if (structuredAttribution.type === 'additive' && structuredAttribution.topContributor) {
    const tc = structuredAttribution.topContributor;
    const dimKey = tc.metric || 'dimension';
    const val = tc.label || tc.dimensionValue;
    if (val) {
      steps.push({
        action: `深挖负贡献或最大贡献子项「${val}」`,
        question: `子项 ${val} 为何对整体变化贡献 ${tc.change}？`,
        reason: '加法型需关注绝对贡献，警惕掩盖效应',
        sql_hint: `SELECT * FROM <表名> WHERE ${dimKey} = ${escapeSqlValue(val)}`,
        filter: `${dimKey} = ${escapeSqlValue(val)}`,
        priority: 'medium',
      });
    }
  }

  return steps;
}

module.exports = {
  escapeSqlValue,
  buildFilterFromPath,
  buildSqlHint,
  buildDrillDownNextSteps,
  buildStructuredAttributionNextSteps,
  buildFollowUpSuggestions,
  generateKeyInsights,
  calculateAnalysisConfidence,
};
