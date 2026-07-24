/**
 * 除法型指标归因：差分分解 + 情景模拟
 */

const { aggregateScalar } = require('./metricStructureClassifier');
const { detectDilutionEffect, appendWarnings } = require('./methodologyWarnings');

function runDivisiveAttribution({
  baseData,
  currentData,
  numeratorField,
  denominatorField,
  targetMetric,
}) {
  const N0 = aggregateScalar(baseData, numeratorField);
  const N1 = aggregateScalar(currentData, numeratorField);
  const D0 = aggregateScalar(baseData, denominatorField);
  const D1 = aggregateScalar(currentData, denominatorField);

  const R0 = D0 !== 0 ? N0 / D0 : 0;
  const R1 = D1 !== 0 ? N1 / D1 : 0;
  const deltaR = R1 - R0;
  const deltaN = N1 - N0;
  const deltaD = D1 - D0;

  const numeratorContrib = D0 !== 0 ? deltaN / D0 : 0;
  const denominatorContrib = D0 !== 0 ? -(N0 / (D0 * D0)) * deltaD : 0;

  const scenarioA = D0 !== 0 ? N1 / D0 : 0;
  const scenarioB = D1 !== 0 ? N0 / D1 : 0;

  const warnings = [];
  const dilution = detectDilutionEffect({
    deltaR,
    deltaN,
    numeratorContrib,
    denominatorContrib,
  });
  if (dilution) warnings.push(dilution);

  const primaryDriver =
    Math.abs(denominatorContrib) > Math.abs(numeratorContrib)
      ? 'denominator'
      : 'numerator';

  return {
    type: 'divisive',
    method: 'differential',
    targetMetric: targetMetric || `${numeratorField}/${denominatorField}`,
    numerator_field: numeratorField,
    denominator_field: denominatorField,
    base: { numerator: N0, denominator: D0, rate: R0 },
    current: { numerator: N1, denominator: D1, rate: R1 },
    delta: {
      rate: deltaR,
      rate_pct: R0 !== 0 ? deltaR / R0 : 0,
      numerator: deltaN,
      denominator: deltaD,
    },
    decomposition: {
      numerator_contrib: numeratorContrib,
      denominator_contrib: denominatorContrib,
      approx_sum: numeratorContrib + denominatorContrib,
    },
    scenarios: {
      A_hold_denominator: {
        label: '分母不变，分子增至现期',
        rate: scenarioA,
        delta_pp: scenarioA - R0,
      },
      B_hold_numerator: {
        label: '分子不变，分母增至现期',
        rate: scenarioB,
        delta_pp: scenarioB - R0,
      },
      actual: {
        label: '实际',
        rate: R1,
        delta_pp: deltaR,
      },
    },
    primary_driver: primaryDriver,
    recommended_drill_dimensions: ['user_cohort', 'is_new_user', 'channel', 'register_date'],
    methodology_warnings: warnings,
  };
}

module.exports = {
  runDivisiveAttribution,
};
