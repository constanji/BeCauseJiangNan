/**
 * 指标数学结构识别：additive / multiplicative / divisive
 */

const { buildWarning } = require('./methodologyWarnings');

const APPROX_TOLERANCE = 0.05;

function sumRows(data, field) {
  return (data || []).reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

function aggregateScalar(data, field) {
  if (!data?.length) return 0;
  const vals = data.map((r) => Number(r[field])).filter((v) => !Number.isNaN(v));
  if (vals.length === 0) return 0;
  if (vals.length === 1) return vals[0];
  return vals.reduce((a, b) => a + b, 0);
}

function approxEqual(a, b, tolerance = APPROX_TOLERANCE) {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale <= tolerance;
}

/**
 * @param {Object} options
 * @returns {{ structure, confidence, reason, warnings }}
 */
function classifyMetricStructure({
  metricStructure = 'auto',
  baseData = [],
  currentData = [],
  metricFields = [],
  targetMetric,
  componentMetrics = [],
  numeratorField,
  denominatorField,
  dimensionFields = [],
}) {
  if (metricStructure && metricStructure !== 'auto') {
    return {
      structure: metricStructure,
      confidence: 1,
      reason: '用户显式指定 metric_structure',
      warnings: [],
    };
  }

  const warnings = [];
  const target = targetMetric || metricFields[0];
  const combined = [...baseData, ...currentData];

  if (numeratorField && denominatorField) {
    return {
      structure: 'divisive',
      confidence: 0.95,
      reason: '提供了 numerator_field 与 denominator_field',
      warnings: [],
    };
  }

  if (target && componentMetrics.length >= 2) {
    const baseTarget = aggregateScalar(baseData, target);
    const baseProduct = componentMetrics.reduce(
      (p, m) => p * aggregateScalar(baseData, m),
      1,
    );
    const baseSum = componentMetrics.reduce(
      (s, m) => s + aggregateScalar(baseData, m),
      0,
    );

    if (approxEqual(baseTarget, baseProduct)) {
      return {
        structure: 'multiplicative',
        confidence: 0.9,
        reason: `target ${target} ≈ 各 component 乘积`,
        warnings: [],
      };
    }
    if (approxEqual(baseTarget, baseSum)) {
      return {
        structure: 'additive',
        confidence: 0.85,
        reason: `target ${target} ≈ 各 component 之和`,
        warnings: [],
      };
    }

    if (baseTarget > 0 && baseProduct > baseTarget * 2) {
      warnings.push(buildWarning('pseudo_additive_risk', {}));
    }
  }

  if (dimensionFields.length > 0 && componentMetrics.length === 0) {
    return {
      structure: 'additive',
      confidence: 0.75,
      reason: '仅有维度字段，走加法型维度贡献度分析',
      warnings: [],
    };
  }

  if (combined.length > 0) {
    const ratioHints = ['rate', 'ratio', 'conversion', 'ctr', 'roi', '留存', '转化'];
    const targetLower = (target || '').toLowerCase();
    if (ratioHints.some((h) => targetLower.includes(h))) {
      return {
        structure: 'divisive',
        confidence: 0.5,
        reason: '指标名暗示比率型，但缺少分子分母字段',
        warnings: [
          buildWarning('low_structure_confidence', { structure: 'divisive', confidence: '0.5' }),
        ],
      };
    }
  }

  return {
    structure: 'additive',
    confidence: 0.4,
    reason: '无法从数据判定结构，默认加法型',
    warnings: [
      buildWarning('low_structure_confidence', { structure: 'additive', confidence: '0.4' }),
    ],
  };
}

module.exports = {
  classifyMetricStructure,
  aggregateScalar,
  approxEqual,
};
