/**
 * DimensionDrillDown - 维度下钻分析模块
 *
 * 基于Adtributor算法的多维度下钻分析：
 * - 逐层维度分析
 * - JS散度计算惊喜度
 * - 解释力排序
 * - 最多10条归因路径
 * - 支持层级关系下钻
 */

const StatisticsEngine = require('./statisticsEngine');
const { projectDirectionalImpacts } = require('./directionalImpact');

class DimensionDrillDown {
  /** 下钻搜索时允许探索/收集的路径数上限（算法内部预算，不直接影响返回体积） */
  static MAX_DRILL_PATHS = 10;
  /** 默认返回给调用方的路径数上限（compact 模式），3.0 默认只留 Top 1 */
  static OUTPUT_MAX_DRILL_PATHS = 1;
  static MIN_CONTRIBUTION_THRESHOLD = 0.01;

  /**
   * 执行Adtributor维度归因分析
   *
   * @param {Object} params
   * @param {Object[]} params.baseData - 基期数据
   * @param {Object[]} params.currentData - 现期数据
   * @param {string} params.metricField - 指标字段
   * @param {string[]} params.dimensionFields - 维度字段列表（按层级排列）
   * @param {Object} params.weights - Adtributor权重 {explanatoryPower, surprise, parsimony}
   * @param {boolean} [params.compact=true] - true=drillPaths 只返回 Top 1（默认）；false=返回全部（最多 MAX_DRILL_PATHS，调试用）
   * @returns {Object} 归因分析结果
   */
  static analyze({ baseData, currentData, metricField, dimensionFields, weights = {}, compact = true }) {
    const baseTotal = baseData.reduce((s, r) => s + (Number(r[metricField]) || 0), 0);
    const currentTotal = currentData.reduce((s, r) => s + (Number(r[metricField]) || 0), 0);
    const totalChange = currentTotal - baseTotal;
    const changeRate = baseTotal !== 0 ? totalChange / baseTotal : 0;

    const dimensionAnalyses = dimensionFields.map((dim) =>
      this._analyzeSingleDimension(baseData, currentData, dim, metricField, totalChange, weights),
    );

    dimensionAnalyses.sort((a, b) => b.adtributorScore - a.adtributorScore);

    const drillPaths = this._buildDrillPaths(
      baseData, currentData, metricField, dimensionFields, totalChange, weights,
    );
    const outputLimit = compact ? this.OUTPUT_MAX_DRILL_PATHS : this.MAX_DRILL_PATHS;

    return {
      overview: {
        baseTotal,
        currentTotal,
        totalChange,
        changeRate,
        changeRatePercent: (changeRate * 100).toFixed(2) + '%',
        direction: totalChange > 0 ? 'increase' : totalChange < 0 ? 'decrease' : 'unchanged',
      },
      dimensionRanking: dimensionAnalyses,
      drillPaths: drillPaths.slice(0, outputLimit),
      total_drill_paths_found: drillPaths.length,
      summary: this._generateSummary(dimensionAnalyses, totalChange, changeRate),
    };
  }

  /**
   * 分析单个维度的归因
   */
  static _analyzeSingleDimension(baseData, currentData, dimensionKey, metricKey, totalChange, weights) {
    const contributions = StatisticsEngine.contributionDecomposition(
      baseData, currentData, dimensionKey, metricKey,
    );

    const baseValues = contributions.map((c) => c.baseValue);
    const currentValues = contributions.map((c) => c.currentValue);

    const baseDist = StatisticsEngine.normalize(baseValues);
    const currentDist = StatisticsEngine.normalize(currentValues);

    const surpriseScore = baseDist.length > 0 && baseDist.length === currentDist.length
      ? StatisticsEngine.jsDivergence(baseDist, currentDist)
      : 0;

    const significantContributions = contributions.filter((c) =>
      totalChange === 0
        ? c.change !== 0
        : Math.abs(c.contributionRate) >= this.MIN_CONTRIBUTION_THRESHOLD,
    );
    const directional = projectDirectionalImpacts(contributions);
    const projectedByValue = new Map(
      directional.items.map((item) => [item.dimensionValue, item]),
    );
    const toPublicItem = (item) => {
      if (!item) return null;
      const projected = projectedByValue.get(item.dimensionValue) || {};
      return {
        value: item.dimensionValue,
        baseValue: item.baseValue,
        currentValue: item.currentValue,
        change: item.change,
        changeRate:
          item.changeRate === Infinity
            ? 'new'
            : `${(item.changeRate * 100).toFixed(2)}%`,
        direction: projected.direction,
        ...(projected.direction_share == null
          ? {}
          : { direction_share: projected.direction_share }),
      };
    };

    const explainedChange = significantContributions.reduce((s, c) => s + c.change, 0);
    const ep = StatisticsEngine.explanatoryPower(totalChange, explainedChange);
    const pars = StatisticsEngine.parsimony(significantContributions.length, contributions.length);
    const score = StatisticsEngine.adtributorScore(ep, surpriseScore, pars, weights);

    return {
      dimension: dimensionKey,
      explanatoryPower: Number(ep.toFixed(4)),
      surprise: Number(surpriseScore.toFixed(6)),
      parsimony: Number(pars.toFixed(4)),
      adtributorScore: Number(score.toFixed(4)),
      topContributors: contributions.slice(0, 3).map(toPublicItem),
      increase_total: directional.increase_total,
      decrease_total: directional.decrease_total,
      top_increase: toPublicItem(directional.top_increase),
      top_decrease: toPublicItem(directional.top_decrease),
      top_increases: directional.top_increases.map(toPublicItem),
      top_decreases: directional.top_decreases.map(toPublicItem),
      totalContributors: contributions.length,
      significantContributors: significantContributions.length,
    };
  }

  /**
   * 构建下钻路径
   * 从最重要的维度开始，逐层下钻
   */
  static _buildDrillPaths(baseData, currentData, metricKey, dimensionFields, totalChange, weights) {
    if (dimensionFields.length < 2) {
      return [];
    }

    const paths = [];
    const firstDimAnalysis = this._analyzeSingleDimension(
      baseData, currentData, dimensionFields[0], metricKey, totalChange, weights,
    );

    const topValues = firstDimAnalysis.topContributors.slice(0, 3);

    for (const topVal of topValues) {
      const filteredBase = baseData.filter(
        (r) => String(r[dimensionFields[0]]) === topVal.value,
      );
      const filteredCurrent = currentData.filter(
        (r) => String(r[dimensionFields[0]]) === topVal.value,
      );

      if (filteredBase.length === 0 && filteredCurrent.length === 0) {
        continue;
      }

      const path = {
        steps: [{
          dimension: dimensionFields[0],
          value: topVal.value,
          change: topVal.change,
          direction: topVal.direction,
          ...(topVal.direction_share == null ? {} : { direction_share: topVal.direction_share }),
        }],
        direction: topVal.direction,
        direction_share: topVal.direction_share,
      };

      this._drillDeeper(
        filteredBase, filteredCurrent, metricKey,
        dimensionFields.slice(1), path, paths, totalChange, weights,
      );

      if (paths.length >= this.MAX_DRILL_PATHS) {
        break;
      }
    }

    paths.sort(
      (a, b) =>
        Math.abs(Number(b.steps?.[0]?.change) || 0) -
        Math.abs(Number(a.steps?.[0]?.change) || 0),
    );
    return paths;
  }

  /**
   * 递归下钻
   */
  static _drillDeeper(baseData, currentData, metricKey, remainingDims, currentPath, allPaths, totalChange, weights) {
    if (remainingDims.length === 0 || allPaths.length >= this.MAX_DRILL_PATHS) {
      allPaths.push({ ...currentPath, steps: [...currentPath.steps] });
      return;
    }

    const nextDim = remainingDims[0];
    const analysis = this._analyzeSingleDimension(
      baseData, currentData, nextDim, metricKey, totalChange, weights,
    );

    if (analysis.topContributors.length === 0) {
      allPaths.push({ ...currentPath, steps: [...currentPath.steps] });
      return;
    }

    const topContributor = analysis.topContributors[0];
    const newStep = {
      dimension: nextDim,
      value: topContributor.value,
      change: topContributor.change,
      direction: topContributor.direction,
      ...(topContributor.direction_share == null
        ? {}
        : { direction_share: topContributor.direction_share }),
      explanatoryPower: analysis.explanatoryPower,
      surprise: analysis.surprise,
    };

    const newPath = {
      steps: [...currentPath.steps, newStep],
      direction: currentPath.direction,
      direction_share: currentPath.direction_share,
    };

    const filteredBase = baseData.filter(
      (r) => String(r[nextDim]) === topContributor.value,
    );
    const filteredCurrent = currentData.filter(
      (r) => String(r[nextDim]) === topContributor.value,
    );

    this._drillDeeper(
      filteredBase, filteredCurrent, metricKey,
      remainingDims.slice(1), newPath, allPaths, totalChange, weights,
    );
  }

  /**
   * 自动识别数据中的维度字段和指标字段
   */
  static autoDetectFields(data) {
    if (!data || data.length === 0) {
      return { dimensionFields: [], metricFields: [] };
    }

    const sample = data[0];
    const dimensionFields = [];
    const metricFields = [];

    for (const [key, value] of Object.entries(sample)) {
      if (typeof value === 'number' && !isNaN(value)) {
        const values = data.map((r) => r[key]);
        const uniqueRatio = new Set(values).size / values.length;
        if (uniqueRatio > 0.5) {
          metricFields.push(key);
        } else {
          metricFields.push(key);
        }
      } else if (typeof value === 'string') {
        const isTime = /\d{4}[-/]\d{2}/.test(String(value));
        if (!isTime) {
          dimensionFields.push(key);
        }
      }
    }

    return { dimensionFields, metricFields };
  }

  /**
   * 生成归因摘要
   */
  static _generateSummary(dimensionAnalyses, totalChange, changeRate) {
    if (dimensionAnalyses.length === 0) {
      return '无法进行维度归因分析，缺少维度数据。';
    }

    const direction = totalChange > 0 ? '上升' : totalChange < 0 ? '下降' : '不变';
    const top = dimensionAnalyses[0];

    let summary = `指标${direction}了${Math.abs(changeRate * 100).toFixed(2)}%。`;

    if (top.adtributorScore > 0.3) {
      summary += `\n主要归因维度为"${top.dimension}"（Adtributor评分: ${top.adtributorScore}）。`;

      if (top.topContributors.length > 0) {
        const topC = top.topContributors[0];
        const directionLabel = topC.direction === 'increase' ? '增加' : topC.direction === 'decrease' ? '减少' : '不变';
        summary += `\n其中"${topC.value}"变化金额绝对值最大，${directionLabel} ${Math.abs(topC.change)}，自身变化率为${topC.changeRate}`;
        if (topC.direction_share != null) {
          summary += `，占全部${directionLabel}项的 ${(topC.direction_share * 100).toFixed(2)}%`;
        }
        summary += '。';
      }

      if (top.surprise > 0.05) {
        summary += `\n该维度的分布变化（惊喜度=${top.surprise.toFixed(4)}）较为显著，说明其结构发生了明显变化。`;
      }
    } else {
      summary += '\n各维度的解释力较为均衡，没有单一维度能够主导解释变化原因。';
    }

    return summary;
  }
}

module.exports = DimensionDrillDown;
