/**
 * 乘法型指标归因：链式分解法
 */

const { aggregateScalar } = require('./metricStructureClassifier');
const {
  detectAmplificationEffect,
  buildWarning,
  appendWarnings,
} = require('./methodologyWarnings');

/**
 * 链式分解：按 factorOrder 顺序
 * contrib_i = (v_i1 - v_i0) * product(v_j0 for j>i) * product(v_j1 for j<i)  — 标准链式
 * 使用文章公式：
 * A: (A1-A0)*B0*C0
 * B: A1*(B1-B0)*C0
 * C: A1*B1*(C1-C0)
 */
function chainRuleDecomposition(baseValues, currentValues, factorOrder) {
  const n = factorOrder.length;
  const contribs = [];
  let reconstructedDelta = 0;

  for (let i = 0; i < n; i++) {
    const key = factorOrder[i];
    const v0 = baseValues[key] ?? 0;
    const v1 = currentValues[key] ?? 0;

    let beforeBase = 1;
    for (let j = 0; j < i; j++) {
      beforeBase *= currentValues[factorOrder[j]] ?? 0;
    }
    let afterBase = 1;
    for (let j = i + 1; j < n; j++) {
      afterBase *= baseValues[factorOrder[j]] ?? 0;
    }

    const contrib = beforeBase * (v1 - v0) * afterBase;
    const pctChange = v0 !== 0 ? (v1 - v0) / v0 : 0;

    contribs.push({
      metric: key,
      name: key,
      baseValue: v0,
      currentValue: v1,
      change: v1 - v0,
      pct_change: pctChange,
      contribution: contrib,
    });
    reconstructedDelta += contrib;
  }

  const baseProduct = factorOrder.reduce((p, k) => p * (baseValues[k] ?? 0), 1);
  const currentProduct = factorOrder.reduce((p, k) => p * (currentValues[k] ?? 0), 1);
  const actualDelta = currentProduct - baseProduct;

  return {
    factors: contribs.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
    baseProduct,
    currentProduct,
    actualDelta,
    reconstructedDelta,
    reconstructionError: baseProduct !== 0
      ? Math.abs(actualDelta - reconstructedDelta) / Math.abs(actualDelta || 1)
      : 0,
  };
}

function aggregateFactorValues(data, fields) {
  const out = {};
  for (const f of fields) {
    out[f] = aggregateScalar(data, f);
  }
  return out;
}

function runMultiplicativeAttribution({
  baseData,
  currentData,
  targetMetric,
  componentMetrics,
  factorOrder,
}) {
  const order = factorOrder?.length ? factorOrder : [...componentMetrics];
  const baseValues = aggregateFactorValues(baseData, order);
  const currentValues = aggregateFactorValues(currentData, order);

  const chain = chainRuleDecomposition(baseValues, currentValues, order);

  const baseTarget = aggregateScalar(baseData, targetMetric) || chain.baseProduct;
  const currentTarget = aggregateScalar(currentData, targetMetric) || chain.currentProduct;
  const totalPctChange =
    baseTarget !== 0 ? (currentTarget - baseTarget) / baseTarget : 0;

  const warnings = [];
  const amp = detectAmplificationEffect(chain.factors, totalPctChange);
  if (amp) warnings.push(amp);

  if (order.length >= 2) {
    warnings.push(
      buildWarning('order_sensitivity_note', { order }),
    );
  }

  const top = chain.factors[0];
  const contributionRates = {};
  const totalAbs = chain.factors.reduce((s, f) => s + Math.abs(f.contribution), 0);
  for (const f of chain.factors) {
    f.contributionRate = totalAbs > 0 ? f.contribution / chain.actualDelta : 0;
    contributionRates[f.metric] = f.contributionRate;
  }

  return {
    type: 'multiplicative',
    method: 'chain_rule',
    targetMetric,
    factor_order: order,
    baseValue: baseTarget,
    currentValue: currentTarget,
    deltaTotal: chain.actualDelta,
    changeRate: totalPctChange,
    factors: chain.factors,
    topContributor: top,
    reconstruction: {
      reconstructed_delta: chain.reconstructedDelta,
      actual_delta: chain.actualDelta,
      error_rate: chain.reconstructionError,
    },
    methodology_warnings: warnings,
  };
}

/**
 * 按 segment 分组后分别链式分解（伪加法检测路径）
 */
function runSegmentedMultiplicative({
  baseData,
  currentData,
  targetMetric,
  componentMetrics,
  factorOrder,
  segmentDimension,
}) {
  const segments = new Set([
    ...baseData.map((r) => String(r[segmentDimension])),
    ...currentData.map((r) => String(r[segmentDimension])),
  ]);

  const segmentResults = [];
  for (const seg of segments) {
    const bSeg = baseData.filter((r) => String(r[segmentDimension]) === seg);
    const cSeg = currentData.filter((r) => String(r[segmentDimension]) === seg);
    if (bSeg.length === 0 && cSeg.length === 0) continue;
    segmentResults.push({
      segment: seg,
      ...runMultiplicativeAttribution({
        baseData: bSeg,
        currentData: cSeg,
        targetMetric,
        componentMetrics,
        factorOrder,
      }),
    });
  }

  return {
    type: 'multiplicative',
    method: 'chain_rule_segmented',
    segment_dimension: segmentDimension,
    segments: segmentResults,
    methodology_warnings: [],
  };
}

module.exports = {
  chainRuleDecomposition,
  runMultiplicativeAttribution,
  runSegmentedMultiplicative,
};
