const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const StatisticsEngine = require('../../utils/statisticsEngine');
const TimeComparison = require('../../utils/timeComparison');
const DimensionDrillDown = require('../../utils/dimensionDrillDown');
const MetricAttribution = require('../../utils/metricAttribution');

// ---- 新增：三类结构归因引擎 ----
const { classifyMetricStructure } = require('../../utils/metricStructureClassifier');
const { runAdditiveAttribution } = require('../../utils/additiveAttribution');
const {
  runMultiplicativeAttribution,
  runSegmentedMultiplicative,
} = require('../../utils/multiplicativeAttribution');
const { runDivisiveAttribution } = require('../../utils/divisiveAttribution');
const { appendWarnings, formatWarningsForConclusion } = require('../../utils/methodologyWarnings');

// ---- 新增：sql_hint 下钻闭环 ----
const {
  buildDrillDownNextSteps,
  buildStructuredAttributionNextSteps,
} = require('../../utils/drillDownHints');

/**
 * FluctuationAttributionTool - 波动归因工具
 *
 * 基于Adtributor算法的智能波动归因分析工具，提供：
 * - 维度归因：哪些维度导致了指标波动（Adtributor算法）
 * - 指标归因：哪些子指标驱动了总指标变化（线性模型 + 特征重要性）
 * - 时间对比：基期/现期对比，支持同比/环比/自定义
 * - 维度下钻：沿维度层级逐层下钻（最多10条路径）
 * - 量化指标：解释力、简洁性、惊喜度（JS散度）
 * - [新增] 三类公式归因：加法（贡献度）/ 乘法（链式分解）/ 除法（差分分解+情景模拟）
 * - [新增] 方法论警示：掩盖效应、放大效应、稀释效应、伪加法陷阱
 * - [新增] sql_hint 下钻闭环：每条 next_steps 携带可执行 SQL 提示
 */
class FluctuationAttributionTool extends Tool {
  name = 'fluctuation_attribution';

  description =
    '波动归因分析工具。当指标发生异常波动时，分析波动的根本原因。' +
    '支持维度归因（哪个维度导致了变化）和指标归因（哪些子指标驱动了变化）。' +
    '使用Adtributor算法计算解释力、惊喜度、简洁性。' +
    '支持同比/环比时间对比，支持多层级维度下钻（最多10条路径）。' +
    '支持加法型/乘法型/除法型三类指标结构归因，自动识别或显式指定 metric_structure。' +
    '输入需要基期数据和现期数据，或提供带时间字段的完整数据集。';

  schema = z.object({
    analysis_type: z
      .enum(['dimension', 'metric', 'comprehensive'])
      .default('comprehensive')
      .describe('分析类型：dimension=维度归因, metric=指标归因, comprehensive=综合归因'),
    base_data: z
      .array(z.record(z.any()))
      .optional()
      .describe('基期数据（行数组），如果提供则直接用于对比'),
    current_data: z
      .array(z.record(z.any()))
      .optional()
      .describe('现期数据（行数组），如果提供则直接用于对比'),
    full_data: z
      .array(z.record(z.any()))
      .optional()
      .describe('完整数据集，工具会自动按时间分割为基期/现期'),
    metric_fields: z
      .array(z.string())
      .min(1)
      .describe('指标字段列表（数值字段，如revenue、order_count）'),
    dimension_fields: z
      .array(z.string())
      .optional()
      .describe('维度字段列表（分类字段，如region、product_category）'),
    time_field: z
      .string()
      .optional()
      .describe('时间字段名（当使用full_data时必须提供）'),
    time_comparison: z
      .object({
        type: z.enum(['year_over_year', 'month_over_month', 'week_over_week', 'day_over_day', 'custom'])
          .default('month_over_month'),
        base_start: z.string().optional(),
        base_end: z.string().optional(),
        current_start: z.string().optional(),
        current_end: z.string().optional(),
      })
      .optional()
      .describe('时间对比配置'),
    component_metrics: z
      .array(z.string())
      .optional()
      .describe('组成指标（用于指标分解归因，如 [客单价, 订单数] 用于分解 收入）'),
    target_metric: z
      .string()
      .optional()
      .describe('目标指标（用于指标分解归因，如 收入）'),
    weights: z
      .object({
        explanatoryPower: z.number().optional(),
        surprise: z.number().optional(),
        parsimony: z.number().optional(),
      })
      .optional()
      .describe('Adtributor权重配置，默认{explanatoryPower:0.5, surprise:0.3, parsimony:0.2}'),
    max_drill_depth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .default(3)
      .describe('最大下钻深度，默认3'),
    // ---- 新增参数 ----
    metric_structure: z
      .enum(['auto', 'additive', 'multiplicative', 'divisive'])
      .optional()
      .default('auto')
      .describe(
        '指标数学结构：auto=自动识别, additive=加法型（如收入=品类A+品类B）, ' +
        'multiplicative=乘法型（如GMV=DAU×转化率×客单价）, divisive=除法型（如转化率=付费用户/DAU）',
      ),
    numerator_field: z
      .string()
      .optional()
      .describe('除法型指标的分子字段（metric_structure=divisive 时使用，如 paid_users）'),
    denominator_field: z
      .string()
      .optional()
      .describe('除法型指标的分母字段（metric_structure=divisive 时使用，如 total_users）'),
    factor_order: z
      .array(z.string())
      .optional()
      .describe(
        '乘法型链式分解的因子顺序（如 [dau, conversion_rate, arpu]），' +
        '应按业务漏斗逻辑排序，顺序影响各因子贡献值',
      ),
  });

  async _call(input) {
    try {
      logger.info('[FluctuationAttributionTool] 开始波动归因分析:', {
        analysisType: input.analysis_type,
        metricFields: input.metric_fields,
        dimensionFields: input.dimension_fields,
        metricStructure: input.metric_structure,
      });

      let { base_data: baseData, current_data: currentData } = input;

      if (!baseData || !currentData) {
        if (!input.full_data || input.full_data.length === 0) {
          return this._errorResult('必须提供 base_data + current_data 或 full_data');
        }
        const splitResult = this._splitDataByTime(input);
        if (splitResult.error) {
          return this._errorResult(splitResult.error);
        }
        baseData = splitResult.baseData;
        currentData = splitResult.currentData;
      }

      if (baseData.length === 0 && currentData.length === 0) {
        return this._errorResult('基期和现期数据均为空，无法进行归因分析');
      }

      const result = {
        analysis_type: input.analysis_type,
        data_summary: {
          base_rows: baseData.length,
          current_rows: currentData.length,
        },
      };

      // 时间对比分析
      if (input.metric_fields.length > 0) {
        result.time_comparison = TimeComparison.analyze({
          baseData,
          currentData,
          metricFields: input.metric_fields,
          dimensionFields: input.dimension_fields || [],
        });
      }

      // 维度归因（Adtributor）
      if (input.analysis_type === 'dimension' || input.analysis_type === 'comprehensive') {
        if (input.dimension_fields && input.dimension_fields.length > 0) {
          const dimFields = input.dimension_fields.slice(0, input.max_drill_depth || 3);
          result.dimension_attribution = DimensionDrillDown.analyze({
            baseData,
            currentData,
            metricField: input.metric_fields[0],
            dimensionFields: dimFields,
            weights: input.weights || {},
          });
        } else {
          result.dimension_attribution = {
            warning: '未提供维度字段，无法进行维度归因。请指定dimension_fields参数。',
          };
        }
      }

      // 指标归因（线性回归/特征重要性）
      if (input.analysis_type === 'metric' || input.analysis_type === 'comprehensive') {
        result.metric_attribution = this._performMetricAttribution(input, baseData, currentData);
      }

      // ---- 新增：三类结构化归因引擎 ----
      const structuredResult = this._performStructuredAttribution(input, baseData, currentData);
      if (structuredResult) {
        result.structured_attribution = structuredResult;
      }

      // 生成综合归因结论（含方法论警示）
      result.conclusion = this._generateConclusion(result, input);

      // 生成后续建议（含 sql_hint）
      result.next_steps = this._generateNextSteps(result, input);

      logger.info('[FluctuationAttributionTool] 归因分析完成:', {
        hasTimeCmp: !!result.time_comparison,
        hasDimAttr: !!result.dimension_attribution?.dimensionRanking,
        hasMetricAttr: !!result.metric_attribution,
        hasStructuredAttr: !!result.structured_attribution,
      });

      return JSON.stringify(result, null, 2);
    } catch (error) {
      logger.error('[FluctuationAttributionTool] 归因分析失败:', error);
      return this._errorResult(`归因分析失败: ${error.message}`);
    }
  }

  /**
   * 三类结构化归因（加法/乘法/除法）
   * 自动识别或使用显式指定的 metric_structure
   */
  _performStructuredAttribution(input, baseData, currentData) {
    const {
      metric_fields: metricFields,
      target_metric: targetMetric,
      component_metrics: componentMetrics,
      dimension_fields: dimensionFields,
      metric_structure: metricStructureInput,
      numerator_field: numeratorField,
      denominator_field: denominatorField,
      factor_order: factorOrder,
    } = input;

    const primaryMetric = targetMetric || metricFields[0];

    // 识别指标结构（显式指定或自动识别）
    const classification = classifyMetricStructure({
      metricStructure: metricStructureInput || 'auto',
      baseData,
      currentData,
      metricFields,
      targetMetric: primaryMetric,
      componentMetrics: componentMetrics || [],
      numeratorField,
      denominatorField,
      dimensionFields: dimensionFields || [],
    });

    const { structure, confidence, reason, warnings: classifyWarnings } = classification;

    // 置信度过低时（0.4 以下）且未显式指定，跳过
    if (confidence < 0.4 && (!metricStructureInput || metricStructureInput === 'auto')) {
      return null;
    }

    let attrResult = null;

    try {
      if (structure === 'additive') {
        attrResult = runAdditiveAttribution({
          baseData,
          currentData,
          targetMetric: primaryMetric,
          componentMetrics: componentMetrics || [],
          dimensionFields: dimensionFields || [],
        });
      } else if (structure === 'multiplicative') {
        if (!componentMetrics || componentMetrics.length < 2) {
          return null;
        }
        attrResult = runMultiplicativeAttribution({
          baseData,
          currentData,
          targetMetric: primaryMetric,
          componentMetrics,
          factorOrder,
        });
      } else if (structure === 'divisive') {
        if (!numeratorField || !denominatorField) {
          return null;
        }
        attrResult = runDivisiveAttribution({
          baseData,
          currentData,
          numeratorField,
          denominatorField,
          targetMetric: primaryMetric,
        });
      }
    } catch (err) {
      logger.warn('[FluctuationAttributionTool] 结构化归因失败:', err.message);
      return null;
    }

    if (!attrResult) return null;

    // 附加结构识别元信息与警示
    attrResult.structure_classification = { structure, confidence, reason };
    attrResult.methodology_warnings = appendWarnings(
      attrResult.methodology_warnings || [],
      ...classifyWarnings,
    );

    return attrResult;
  }

  /**
   * 按时间分割数据
   */
  _splitDataByTime(input) {
    const { full_data: data, time_field: timeField, time_comparison: timeCfg } = input;

    const actualTimeField = timeField || TimeComparison.detectTimeField(data);
    if (!actualTimeField) {
      return { error: '无法自动检测时间字段，请提供time_field参数' };
    }

    if (timeCfg?.type === 'custom' && timeCfg.base_start && timeCfg.base_end && timeCfg.current_start && timeCfg.current_end) {
      return TimeComparison.splitByPeriod(
        data, actualTimeField,
        timeCfg.base_start, timeCfg.base_end,
        timeCfg.current_start, timeCfg.current_end,
      );
    }

    const times = data.map((r) => new Date(r[actualTimeField]).getTime()).filter((t) => !isNaN(t));
    if (times.length === 0) {
      return { error: `时间字段"${actualTimeField}"中没有有效的时间值` };
    }

    const maxTime = new Date(Math.max(...times));
    const minTime = new Date(Math.min(...times));
    const midTime = new Date((minTime.getTime() + maxTime.getTime()) / 2);

    let currentStart, currentEnd, baseStart, baseEnd;

    if (timeCfg?.type && timeCfg.type !== 'custom') {
      currentEnd = maxTime;
      currentStart = midTime;
      const basePeriod = TimeComparison.calculateBasePeriod(currentStart, currentEnd, timeCfg.type);
      baseStart = basePeriod.baseStart;
      baseEnd = basePeriod.baseEnd;
    } else {
      baseStart = minTime;
      baseEnd = midTime;
      currentStart = midTime;
      currentEnd = maxTime;
    }

    return TimeComparison.splitByPeriod(
      data, actualTimeField,
      baseStart, baseEnd,
      currentStart, currentEnd,
    );
  }

  /**
   * 执行指标归因（线性回归/ElasticNet/特征重要性）
   */
  _performMetricAttribution(input, baseData, currentData) {
    const result = {};

    if (input.metric_fields.length > 1) {
      const allData = [...baseData, ...currentData];
      result.correlation = MetricAttribution.metricCorrelation(allData, input.metric_fields);
    }

    if (input.target_metric && input.component_metrics && input.component_metrics.length > 0) {
      result.decomposition = MetricAttribution.metricDecomposition({
        baseData,
        currentData,
        targetMetric: input.target_metric,
        componentMetrics: input.component_metrics,
      });
    }

    if (input.dimension_fields && input.dimension_fields.length > 0 && input.metric_fields.length > 0) {
      const allData = [...baseData, ...currentData];
      const encoded = this._encodeDimensionsAsFeatures(allData, input.dimension_fields);
      if (encoded.X.length > 0) {
        const Y = allData.map((r) => Number(r[input.metric_fields[0]]) || 0);
        result.feature_importance = MetricAttribution.featureImportance(
          encoded.X, Y, encoded.featureNames,
        );

        const elasticResult = MetricAttribution.elasticNet(encoded.X, Y, 0.1, 0.5);
        result.regression = {
          method: 'ElasticNet',
          rSquared: Number(elasticResult.rSquared.toFixed(4)),
          intercept: Number(elasticResult.intercept.toFixed(4)),
          nonZeroFeatures: encoded.featureNames
            .map((name, i) => ({ name, coefficient: elasticResult.coefficients[i] }))
            .filter((f) => Math.abs(f.coefficient) > 1e-6)
            .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))
            .slice(0, 10),
        };
      }
    }

    return result;
  }

  /**
   * 将分类维度编码为数值特征（One-hot编码简化版）
   */
  _encodeDimensionsAsFeatures(data, dimensionFields) {
    const featureNames = [];
    const encodingMap = {};

    for (const dim of dimensionFields) {
      const valueCounts = {};
      data.forEach((r) => {
        const v = String(r[dim]);
        valueCounts[v] = (valueCounts[v] || 0) + 1;
      });
      const topValues = Object.entries(valueCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([v]) => v);

      encodingMap[dim] = topValues;
      topValues.forEach((v) => featureNames.push(`${dim}=${v}`));
    }

    const X = data.map((row) => {
      const features = [];
      for (const dim of dimensionFields) {
        const topValues = encodingMap[dim];
        topValues.forEach((v) => {
          features.push(String(row[dim]) === v ? 1 : 0);
        });
      }
      return features;
    });

    return { X, featureNames };
  }

  /**
   * 生成综合归因结论（含方法论警示）
   */
  _generateConclusion(result, input) {
    const lines = [];

    if (result.time_comparison?.overview) {
      const ov = result.time_comparison.overview;
      const dirMap = { increase: '上升', decrease: '下降', unchanged: '持平' };
      lines.push(`【总体趋势】${ov.primaryMetric} ${dirMap[ov.direction] || ov.direction}了${ov.changeRate}（绝对变化: ${ov.absoluteChange}）`);
    }

    // 结构化归因结论
    if (result.structured_attribution) {
      const sa = result.structured_attribution;
      if (sa.type === 'additive' && sa.topContributor) {
        const tc = sa.topContributor;
        const label = tc.label || tc.metric || tc.dimensionValue;
        lines.push(`【加法归因】最大贡献子项: ${label}（变化 ${tc.change?.toFixed ? tc.change.toFixed(2) : tc.change}，贡献率 ${typeof tc.contributionRate === 'number' ? (tc.contributionRate * 100).toFixed(1) : tc.contributionRate}%）`);
      } else if (sa.type === 'multiplicative' && sa.topContributor) {
        const tc = sa.topContributor;
        lines.push(`【乘法链式归因】最大驱动因子: ${tc.metric}（贡献值 ${typeof tc.contribution === 'number' ? tc.contribution.toFixed(2) : tc.contribution}，变化率 ${typeof tc.pct_change === 'number' ? (tc.pct_change * 100).toFixed(1) : tc.pct_change}%）`);
        if (sa.reconstruction?.error_rate < 0.01) {
          lines.push(`【分解验证】链式分解重建误差 ${(sa.reconstruction.error_rate * 100).toFixed(2)}%，精度良好`);
        }
      } else if (sa.type === 'divisive') {
        const driver = sa.primary_driver === 'denominator' ? '分母扩张（稀释效应）' : '分子变化';
        lines.push(`【除法差分归因】主要驱动: ${driver}，分子贡献 ${sa.decomposition?.numerator_contrib?.toFixed(4)}，分母贡献 ${sa.decomposition?.denominator_contrib?.toFixed(4)}`);
      }

      // 方法论警示
      const warnings = sa.methodology_warnings || [];
      if (warnings.length > 0) {
        lines.push(`\n【方法论警示】\n${formatWarningsForConclusion(warnings)}`);
      }
    }

    // Adtributor 维度归因结论
    if (result.dimension_attribution?.summary) {
      lines.push(`【维度归因】${result.dimension_attribution.summary}`);
    }

    if (result.dimension_attribution?.drillPaths?.length > 0) {
      const topPath = result.dimension_attribution.drillPaths[0];
      const pathStr = topPath.steps.map((s) => `${s.dimension}="${s.value}"`).join(' → ');
      lines.push(`【下钻路径】最显著的归因路径: ${pathStr}`);
    }

    // 指标归因结论
    if (result.metric_attribution?.decomposition) {
      const decomp = result.metric_attribution.decomposition;
      const topComp = decomp.components?.sort((a, b) => b.importance - a.importance)[0];
      if (topComp) {
        lines.push(`【指标归因】${decomp.targetMetric}的变化主要由${topComp.metric}驱动（重要性: ${(topComp.importance * 100).toFixed(1)}%）`);
      }
    }

    if (result.metric_attribution?.feature_importance?.length > 0) {
      const topFeature = result.metric_attribution.feature_importance[0];
      lines.push(`【特征重要性】最重要的特征: ${topFeature.feature}（归一化重要性: ${(topFeature.normalizedImportance * 100).toFixed(1)}%）`);
    }

    return lines.length > 0 ? lines.join('\n') : '数据量不足，无法生成有效的归因结论。';
  }

  /**
   * 生成后续建议（含 sql_hint 下钻闭环）
   */
  _generateNextSteps(result, input) {
    const steps = [];
    const metricField = input.metric_fields[0];

    // 基于维度归因的 Adtributor 下钻（含 sql_hint）
    const dimAttr = result.dimension_attribution;
    if (dimAttr && !dimAttr.warning) {
      const drillSteps = buildDrillDownNextSteps(dimAttr, metricField);
      for (const s of drillSteps) {
        steps.push(s);
      }
    } else if (dimAttr?.dimensionRanking?.length > 0) {
      const top = dimAttr.dimensionRanking[0];
      if (top.surprise > 0.05) {
        steps.push({
          action: `深入分析"${top.dimension}"维度的分布变化`,
          reason: `该维度惊喜度较高(${top.surprise.toFixed(4)})，分布发生了显著结构性变化`,
          sql_hint: `SELECT ${top.dimension}, SUM(${metricField}) AS ${metricField} FROM <表名> GROUP BY ${top.dimension}`,
          priority: 'high',
        });
      }
    }

    // 基于结构化归因的下钻（含 sql_hint）
    if (result.structured_attribution) {
      const structuredSteps = buildStructuredAttributionNextSteps(result.structured_attribution, metricField);
      for (const s of structuredSteps) {
        steps.push(s);
      }
    }

    // 时间对比显著性
    if (result.time_comparison?.metricComparisons?.length > 0) {
      const mc = result.time_comparison.metricComparisons[0];
      if (mc.significance?.significant) {
        steps.push({
          action: '调查引起显著变化的外部事件',
          reason: `${mc.metric}的变化在统计上显著（${mc.significance.reason}）`,
          priority: 'high',
        });
      }
    }

    // 指标相关性
    if (result.metric_attribution?.correlation?.keyFindings?.length > 0) {
      const finding = result.metric_attribution.correlation.keyFindings[0];
      steps.push({
        action: `关注${finding.metric1}和${finding.metric2}之间的关联`,
        reason: `两个指标存在${finding.strength === 'very_strong' ? '非常强' : '强'}的${finding.direction === 'positive' ? '正' : '负'}相关(r=${finding.correlation})`,
        priority: 'medium',
      });
    }

    return steps;
  }

  _errorResult(message) {
    return JSON.stringify({ success: false, error: message }, null, 2);
  }
}

module.exports = FluctuationAttributionTool;
