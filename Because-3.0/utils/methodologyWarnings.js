/**
 * 方法论警示：掩盖效应、放大效应、稀释效应、伪加法、低置信度结构识别
 */

const WARNING_DEFINITIONS = {
  masking_effect: {
    severity: 'high',
    title: '掩盖效应',
    template: (ctx) =>
      `整体${ctx.direction}，但子项「${ctx.items}」绝对贡献为负，高增长子项可能掩盖结构恶化，需同时关注绝对值变动。`,
  },
  amplification_effect: {
    severity: 'high',
    title: '放大效应',
    template: (ctx) =>
      `因子「${ctx.factor}」变化 ${ctx.factorPct}%，整体指标变化 ${ctx.totalPct}%，中间漏斗因子微小变动被显著放大，建议重点监控。`,
  },
  dilution_effect: {
    severity: 'high',
    title: '稀释效应',
    template: (ctx) =>
      `比率下降主要由分母扩张驱动（分母贡献 ${ctx.denominatorContrib}），分子${ctx.numeratorChange}，可能是用户结构稀释而非转化能力变差。`,
  },
  pseudo_additive_risk: {
    severity: 'medium',
    title: '伪加法风险',
    template: () =>
      '目标指标可能为乘法结构（如 GMV=DAU×转化率×客单价），不宜强行按加法拆解；建议先分组再乘法归因或传 metric_structure=multiplicative。',
  },
  low_structure_confidence: {
    severity: 'medium',
    title: '指标结构识别置信度低',
    template: (ctx) =>
      `自动识别为 ${ctx.structure}（置信度 ${ctx.confidence}），建议显式传入 metric_structure 与 component_metrics / numerator_field / denominator_field。`,
  },
  order_sensitivity_note: {
    severity: 'low',
    title: '链式分解顺序',
    template: (ctx) =>
      `乘法链式分解按顺序 [${ctx.order.join(' → ')}] 计算，顺序会影响各因子贡献值，建议按业务漏斗逻辑排序 factor_order。`,
  },
};

/**
 * @param {string} code
 * @param {Object} context
 * @returns {{ code, severity, title, message }}
 */
function buildWarning(code, context = {}) {
  const def = WARNING_DEFINITIONS[code];
  if (!def) {
    return { code, severity: 'low', title: code, message: JSON.stringify(context) };
  }
  return {
    code,
    severity: def.severity,
    title: def.title,
    message: def.template(context),
  };
}

/**
 * 加法型：掩盖效应
 */
function detectMaskingEffect(deltaTotal, components, threshold = 0.2) {
  if (deltaTotal <= 0 || !components?.length) return null;

  const negativeItems = components.filter((c) => c.change < 0);
  const masked = negativeItems.filter(
    (c) => Math.abs(c.change) / Math.abs(deltaTotal) > threshold,
  );

  if (masked.length === 0) return null;

  return buildWarning('masking_effect', {
    direction: '上升',
    items: masked.map((c) => c.label || c.metric || c.dimensionValue).join('、'),
  });
}

/**
 * 乘法型：放大效应
 */
function detectAmplificationEffect(factors, totalPctChange) {
  if (!factors?.length || totalPctChange === 0) return null;

  const totalAbs = Math.abs(totalPctChange);
  for (const f of factors) {
    const factorAbs = Math.abs(f.pct_change ?? 0);
    if (factorAbs > 0 && factorAbs < totalAbs * 0.9 && Math.sign(f.pct_change) === Math.sign(totalPctChange)) {
      return buildWarning('amplification_effect', {
        factor: f.name || f.metric,
        factorPct: `${(f.pct_change * 100).toFixed(1)}%`,
        totalPct: `${(totalPctChange * 100).toFixed(1)}%`,
      });
    }
  }
  return null;
}

/**
 * 除法型：稀释效应
 */
function detectDilutionEffect({ deltaR, deltaN, numeratorContrib, denominatorContrib }) {
  if (deltaR >= 0 || deltaN <= 0) return null;

  const numAbs = Math.abs(numeratorContrib ?? 0);
  const denAbs = Math.abs(denominatorContrib ?? 0);
  if (denAbs <= numAbs) return null;

  return buildWarning('dilution_effect', {
    denominatorContrib: typeof denominatorContrib === 'number'
      ? denominatorContrib.toFixed(4)
      : String(denominatorContrib),
    numeratorChange: deltaN > 0 ? '仍增长' : '下降',
  });
}

function appendWarnings(existing, ...newWarnings) {
  const list = [...(existing || [])];
  for (const w of newWarnings) {
    if (w && !list.some((x) => x.code === w.code)) list.push(w);
  }
  return list;
}

/**
 * 将 warnings 格式化为结论文本段落
 */
function formatWarningsForConclusion(warnings) {
  if (!warnings?.length) return '';
  return warnings.map((w) => `【${w.title}】${w.message}`).join('\n');
}

module.exports = {
  WARNING_DEFINITIONS,
  buildWarning,
  detectMaskingEffect,
  detectAmplificationEffect,
  detectDilutionEffect,
  appendWarnings,
  formatWarningsForConclusion,
};
