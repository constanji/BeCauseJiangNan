/**
 * 加法型指标归因：贡献度分解 + 掩盖效应检测
 */

const StatisticsEngine = require('./statisticsEngine');
const { detectMaskingEffect, appendWarnings } = require('./methodologyWarnings');

/** 默认返回的最大子项数（按 |change| 降序），避免高基数维度（机构/客户）把整段 JSON 撑爆 */
const MAX_COMPONENTS = 10;

function sumMetric(data, metricKey) {
  return (data || []).reduce((s, r) => s + (Number(r[metricKey]) || 0), 0);
}

/**
 * 按 |change| 降序排序后截断，返回值附带 total/omitted 计数，
 * 让模型知道明细已被裁剪、还有多少条被省略，而不是误以为只有这几项。
 */
function sortAndCapComponents(components, maxComponents) {
  const sorted = [...components].sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const totalComponents = sorted.length;
  const shouldCap = Number.isFinite(maxComponents) && totalComponents > maxComponents;
  const output = shouldCap ? sorted.slice(0, maxComponents) : sorted;
  return {
    sorted,
    output,
    totalComponents,
    omittedComponents: shouldCap ? totalComponents - output.length : 0,
  };
}

/**
 * 对 component_metrics 或单行汇总做加法贡献度
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
        contributionRate: deltaTotal !== 0 ? change / deltaTotal : 0,
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
      contributionRate: c.contributionRate,
      unexpectedChange: c.unexpectedChange,
    }));
  }

  // 掩盖效应检测必须看全量子项，不能在截断后的列表上判断，否则会漏判
  const masking = detectMaskingEffect(deltaTotal, components);
  if (masking) warnings.push(masking);

  const { output, totalComponents, omittedComponents } = sortAndCapComponents(
    components,
    maxComponents,
  );

  return {
    type: 'additive',
    method: 'contribution',
    targetMetric,
    baseValue: baseTotal,
    currentValue: currentTotal,
    deltaTotal,
    changeRate: baseTotal !== 0 ? deltaTotal / baseTotal : 0,
    components: output,
    total_components: totalComponents,
    omitted_components: omittedComponents,
    topContributor: output[0] || null,
    methodology_warnings: warnings,
  };
}

/**
 * 多维度分别做贡献度（套餐案例）
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
      contributionRate: deltaTotal !== 0 ? c.change / deltaTotal : 0,
    }));
    const masking = detectMaskingEffect(deltaTotal, components);
    const { output, totalComponents, omittedComponents } = sortAndCapComponents(
      components,
      maxComponents,
    );
    byDimension[dim] = {
      deltaTotal,
      components: output,
      total_components: totalComponents,
      omitted_components: omittedComponents,
      methodology_warnings: masking ? [masking] : [],
    };
  }

  const primary = dimensionFields[0];
  const primaryResult = byDimension[primary];
  return {
    type: 'additive',
    method: 'contribution',
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
