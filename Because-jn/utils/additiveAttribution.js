/**
 * 加法型指标归因：方向影响分解 + 掩盖效应检测
 */

const StatisticsEngine = require('./statisticsEngine');
const { detectMaskingEffect, appendWarnings } = require('./methodologyWarnings');
const { capComponentsWithSummary } = require('./capComponents');
const { projectDirectionalImpacts } = require('./directionalImpact');

/** 默认返回的最大子项数（按 |change| 降序），避免高基数维度（机构/客户）把整段 JSON 撑爆 */
const MAX_COMPONENTS = 10;

function sumMetric(data, metricKey) {
  return (data || []).reduce((s, r) => s + (Number(r[metricKey]) || 0), 0);
}

/**
 * 按 |change| 降序排序后截断，返回值附带 total/omitted 计数 + 被省略部分的
 * 增减聚合摘要（omittedSummary），避免模型因看不到被截断的尾部而误判整体方向。
 */
function sortAndCapComponents(components, maxComponents) {
  return capComponentsWithSummary(components, { maxComponents, changeField: 'change' });
}

/**
 * 对 component_metrics 或单行汇总做加法方向影响分解
 */
function analyzeAdditiveFromComponents({
  baseData,
  currentData,
  targetMetric,
  componentMetrics = [],
  dimensionFields = [],
  maxComponents = MAX_COMPONENTS,
}) {
  const warnings = [];
  const baseTotal = sumMetric(baseData, targetMetric);
  const currentTotal = sumMetric(currentData, targetMetric);
  const deltaTotal = currentTotal - baseTotal;

  let components = [];

  if (componentMetrics.length > 0) {
    components = componentMetrics.map((metric) => {
      const baseVal = sumMetric(baseData, metric);
      const currentVal = sumMetric(currentData, metric);
      const change = currentVal - baseVal;
      return {
        metric,
        label: metric,
        baseValue: baseVal,
        currentValue: currentVal,
        change,
        changeRate: baseVal !== 0 ? change / baseVal : currentVal !== 0 ? Infinity : 0,
      };
    });
  } else if (dimensionFields.length > 0) {
    const dim = dimensionFields[0];
    const contribs = StatisticsEngine.contributionDecomposition(
      baseData,
      currentData,
      dim,
      targetMetric,
    );
    components = contribs.map((c) => ({
      dimensionValue: c.dimensionValue,
      label: c.dimensionValue,
      metric: dim,
      baseValue: c.baseValue,
      currentValue: c.currentValue,
      change: c.change,
      changeRate: c.changeRate,
      unexpectedChange: c.unexpectedChange,
    }));
  }

  // 掩盖效应检测必须看全量子项，不能在截断后的列表上判断，否则会漏判
  const masking = detectMaskingEffect(deltaTotal, components);
  if (masking) warnings.push(masking);

  const directional = projectDirectionalImpacts(components);
  const { output, totalComponents, omittedComponents, omittedSummary } = sortAndCapComponents(
    directional.items,
    maxComponents,
  );

  return {
    type: 'additive',
    method: 'directional_impact',
    targetMetric,
    baseValue: baseTotal,
    currentValue: currentTotal,
    deltaTotal,
    changeRate: baseTotal !== 0 ? deltaTotal / baseTotal : 0,
    components: output,
    total_components: totalComponents,
    omitted_components: omittedComponents,
    increase_total: directional.increase_total,
    decrease_total: directional.decrease_total,
    top_increase: directional.top_increase,
    top_decrease: directional.top_decrease,
    ...(omittedSummary ? { omitted_summary: omittedSummary } : {}),
    methodology_warnings: warnings,
  };
}

/**
 * 多维度分别做方向影响分解（套餐案例）
 */
function analyzeAdditiveByDimensions({
  baseData,
  currentData,
  targetMetric,
  dimensionFields,
  maxComponents = MAX_COMPONENTS,
}) {
  const byDimension = {};

  for (const dim of dimensionFields) {
    const contribs = StatisticsEngine.contributionDecomposition(
      baseData,
      currentData,
      dim,
      targetMetric,
    );
    const baseTotal = sumMetric(baseData, targetMetric);
    const currentTotal = sumMetric(currentData, targetMetric);
    const deltaTotal = currentTotal - baseTotal;
    const components = contribs.map((c) => ({
      ...c,
      label: c.dimensionValue,
    }));
    const directional = projectDirectionalImpacts(components);
    const masking = detectMaskingEffect(deltaTotal, components);
    const { output, totalComponents, omittedComponents, omittedSummary } = sortAndCapComponents(
      directional.items,
      maxComponents,
    );
    byDimension[dim] = {
      deltaTotal,
      components: output,
      total_components: totalComponents,
      omitted_components: omittedComponents,
      increase_total: directional.increase_total,
      decrease_total: directional.decrease_total,
      top_increase: directional.top_increase,
      top_decrease: directional.top_decrease,
      ...(omittedSummary ? { omitted_summary: omittedSummary } : {}),
      methodology_warnings: masking ? [masking] : [],
    };
  }

  const primary = dimensionFields[0];
  const primaryResult = byDimension[primary];
  return {
    type: 'additive',
    method: 'directional_impact',
    targetMetric,
    ...primaryResult,
    by_dimension: byDimension,
    methodology_warnings: primaryResult?.methodology_warnings || [],
  };
}

function runAdditiveAttribution(input) {
  const {
    baseData,
    currentData,
    targetMetric,
    componentMetrics = [],
    dimensionFields = [],
    maxComponents = MAX_COMPONENTS,
  } = input;

  if (componentMetrics.length > 0) {
    return analyzeAdditiveFromComponents({ ...input, maxComponents });
  }
  if (dimensionFields.length > 0) {
    return analyzeAdditiveByDimensions({
      baseData,
      currentData,
      targetMetric,
      dimensionFields,
      maxComponents,
    });
  }

  return analyzeAdditiveFromComponents({
    baseData,
    currentData,
    targetMetric,
    componentMetrics: [],
    dimensionFields: [],
    maxComponents,
  });
}

module.exports = {
  runAdditiveAttribution,
  analyzeAdditiveFromComponents,
  sumMetric,
  MAX_COMPONENTS,
};
