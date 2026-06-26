/**
 * 加法型指标归因：贡献度分解 + 掩盖效应检测
 */

const StatisticsEngine = require('./statisticsEngine');
const { detectMaskingEffect, appendWarnings } = require('./methodologyWarnings');

function sumMetric(data, metricKey) {
  return (data || []).reduce((s, r) => s + (Number(r[metricKey]) || 0), 0);
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

  const masking = detectMaskingEffect(deltaTotal, components);
  if (masking) warnings.push(masking);

  const sorted = [...components].sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return {
    type: 'additive',
    method: 'contribution',
    targetMetric,
    baseValue: baseTotal,
    currentValue: currentTotal,
    deltaTotal,
    changeRate: baseTotal !== 0 ? deltaTotal / baseTotal : 0,
    components: sorted,
    topContributor: sorted[0] || null,
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
    byDimension[dim] = {
      deltaTotal,
      components,
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
  } = input;

  if (componentMetrics.length > 0) {
    return analyzeAdditiveFromComponents(input);
  }
  if (dimensionFields.length > 0) {
    return analyzeAdditiveByDimensions({
      baseData,
      currentData,
      targetMetric,
      dimensionFields,
    });
  }

  return analyzeAdditiveFromComponents({
    baseData,
    currentData,
    targetMetric,
    componentMetrics: [],
    dimensionFields: [],
  });
}

module.exports = {
  runAdditiveAttribution,
  analyzeAdditiveFromComponents,
  sumMetric,
};
