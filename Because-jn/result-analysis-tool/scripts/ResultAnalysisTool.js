const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const StatisticsEngine = require('../../utils/statisticsEngine');
const MetricAttribution = require('../../utils/metricAttribution');

/**
 * ResultAnalysisTool - 查询结果快照解读（瘦身版）
 *
 * 仅做单期结果的统计/异常/趋势/相关；**不**生成 sql_hint、不替代波动归因。
 * 两期变化与机构/公式下钻请用 fluctuation-attribution。
 */
class ResultAnalysisTool extends Tool {
  name = 'result_analysis';

  description =
    'SQL查询结果快照解读：统计、异常、趋势、指标相关。' +
    '入参 results（或 data.rows），可选 sql/context/analysis_depth。' +
    '不生成下钻 SQL；波动归因请用 fluctuation-attribution。';

  schema = z.object({
    sql: z.string().optional().default('').describe('可选，仅作摘要旁注，不会执行'),
    results: z.array(z.any()).optional().describe('查询结果行数组'),
    data: z
      .object({
        rows: z.array(z.any()).optional(),
        columns: z.array(z.string()).optional(),
      })
      .optional()
      .describe('兼容写法：等价于 results=data.rows'),
    row_count: z.number().int().nonnegative().optional(),
    analysis_depth: z
      .enum(['basic', 'standard', 'deep'])
      .optional()
      .default('standard')
      .describe('basic=摘要, standard=+统计/异常/趋势, deep=+相关'),
    analysis_type: z.string().optional().describe('兼容别名，等同 analysis_depth'),
    context: z.string().optional().describe('可选业务上下文'),
  });

  normalizeInput(input = {}) {
    const results = Array.isArray(input.results)
      ? input.results
      : Array.isArray(input.data?.rows)
        ? input.data.rows
        : [];
    const sql = typeof input.sql === 'string' ? input.sql : '';
    const rawDepth = input.analysis_depth || input.analysis_type || 'standard';
    const analysis_depth = ['basic', 'standard', 'deep'].includes(rawDepth)
      ? rawDepth
      : 'standard';
    return {
      sql,
      results,
      row_count: input.row_count,
      analysis_depth,
      context: typeof input.context === 'string' ? input.context : '',
    };
  }

  classifyFields(results) {
    if (!results || results.length === 0) {
      return { numericFields: [], categoricalFields: [], timeFields: [], booleanFields: [] };
    }

    const sample = results.slice(0, Math.min(20, results.length));
    const fields = Object.keys(sample[0]);
    const numericFields = [];
    const categoricalFields = [];
    const timeFields = [];
    const booleanFields = [];

    for (const field of fields) {
      const values = sample.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
      if (values.length === 0) continue;

      const numericCount = values.filter(
        (v) => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== ''),
      ).length;
      const boolCount = values.filter((v) => typeof v === 'boolean' || v === 0 || v === 1).length;
      const timeCount = values.filter((v) => {
        if (typeof v !== 'string') return false;
        return /\d{4}[-/]\d{2}/.test(v) || !isNaN(Date.parse(v));
      }).length;

      if (timeCount > values.length * 0.5) {
        timeFields.push(field);
      } else if (boolCount === values.length && new Set(values.map(String)).size <= 2) {
        booleanFields.push(field);
      } else if (numericCount > values.length * 0.7) {
        numericFields.push(field);
      } else {
        categoricalFields.push(field);
      }
    }

    return { numericFields, categoricalFields, timeFields, booleanFields };
  }

  performStatisticalAnalysis(results, numericFields) {
    const stats = {};
    for (const field of numericFields) {
      const values = results.map((r) => Number(r[field])).filter((v) => !isNaN(v));
      if (values.length === 0) continue;
      const basic = StatisticsEngine.basicStats(values);
      const cv = StatisticsEngine.coefficientOfVariation(values);
      stats[field] = {
        ...basic,
        coefficientOfVariation: Number(cv.toFixed(4)),
        distribution:
          cv < 0.1 ? 'very_uniform' : cv < 0.3 ? 'uniform' : cv < 0.7 ? 'moderate' : 'dispersed',
      };
    }
    return stats;
  }

  detectAnomalies(results, numericFields) {
    const anomalies = [];
    for (const field of numericFields) {
      const values = results
        .map((r, i) => ({ value: Number(r[field]), index: i }))
        .filter((v) => !isNaN(v.value))
        .sort((a, b) => a.value - b.value);
      if (values.length < 4) continue;

      const q1 = values[Math.floor(values.length * 0.25)].value;
      const q3 = values[Math.floor(values.length * 0.75)].value;
      const iqr = q3 - q1;
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;
      const outliers = values.filter((v) => v.value < lowerBound || v.value > upperBound);
      if (outliers.length > 0) {
        anomalies.push({
          field,
          outlierCount: outliers.length,
          outlierRate: Number((outliers.length / values.length).toFixed(4)),
          bounds: { lower: Number(lowerBound.toFixed(4)), upper: Number(upperBound.toFixed(4)) },
          extremeValues: outliers.slice(0, 5).map((o) => ({
            rowIndex: o.index,
            value: o.value,
            direction: o.value < lowerBound ? 'below' : 'above',
          })),
        });
      }
    }
    return anomalies;
  }

  detectTimeTrend(results, timeField, numericFields) {
    if (!timeField || numericFields.length === 0) return null;
    const sorted = [...results].sort((a, b) => new Date(a[timeField]) - new Date(b[timeField]));
    const trends = {};
    for (const metric of numericFields.slice(0, 3)) {
      const values = sorted.map((r) => Number(r[metric])).filter((v) => !isNaN(v));
      if (values.length < 3) continue;
      const indices = values.map((_, i) => i);
      const regression = StatisticsEngine.linearRegression(indices, values);
      let direction;
      if (regression.rSquared < 0.1) direction = 'no_trend';
      else if (regression.slope > 0) direction = 'increasing';
      else direction = 'decreasing';
      trends[metric] = {
        direction,
        slope: Number(regression.slope.toFixed(6)),
        rSquared: Number(regression.rSquared.toFixed(4)),
        strength:
          regression.rSquared > 0.7 ? 'strong' : regression.rSquared > 0.3 ? 'moderate' : 'weak',
      };
    }
    return Object.keys(trends).length ? trends : null;
  }

  performCorrelationAnalysis(results, numericFields) {
    if (numericFields.length < 2) return null;
    return MetricAttribution.metricCorrelation(results, numericFields.slice(0, 5));
  }

  _generateKeyInsights(analysis) {
    const { results, fieldTypes, stats, anomalies, trends, correlation } = analysis;
    if (!results || results.length === 0) return [];
    const insights = [];

    if (stats) {
      for (const [field, stat] of Object.entries(stats)) {
        if (stat.coefficientOfVariation > 0.5) {
          insights.push({
            type: 'distribution',
            dimension: field,
            value: `变异系数=${stat.coefficientOfVariation}，数据分散度较高`,
            impact: `范围: ${stat.min} ~ ${stat.max}，均值: ${stat.mean.toFixed(2)}`,
            importance: 'medium',
          });
        }
      }
    }

    if (anomalies?.length) {
      for (const anomaly of anomalies.slice(0, 3)) {
        insights.push({
          type: 'anomaly',
          dimension: anomaly.field,
          value: `发现${anomaly.outlierCount}个异常值`,
          impact: `异常值比例${(anomaly.outlierRate * 100).toFixed(1)}%`,
          importance: 'high',
        });
      }
    }

    if (trends) {
      for (const [metric, trend] of Object.entries(trends)) {
        if (trend.direction !== 'no_trend') {
          insights.push({
            type: 'trend',
            dimension: metric,
            value: `${trend.direction === 'increasing' ? '上升' : '下降'}趋势(R²=${trend.rSquared})`,
            impact: `趋势强度: ${trend.strength}`,
            importance: trend.strength === 'strong' ? 'high' : 'medium',
          });
        }
      }
    }

    if (correlation?.keyFindings?.length) {
      for (const finding of correlation.keyFindings.slice(0, 2)) {
        insights.push({
          type: 'correlation',
          dimension: `${finding.metric1} × ${finding.metric2}`,
          value: `相关系数=${finding.correlation}`,
          impact: `${finding.strength === 'very_strong' ? '非常强' : '强'}的${finding.direction === 'positive' ? '正' : '负'}相关`,
          importance: 'medium',
        });
      }
    }

    if (insights.length === 0 && fieldTypes.numericFields.length > 0) {
      for (const field of fieldTypes.numericFields.slice(0, 3)) {
        const values = results.map((r) => Number(r[field])).filter((v) => !isNaN(v));
        if (values.length === 0) continue;
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        insights.push({
          type: 'basic_stat',
          dimension: field,
          value: `总计: ${sum.toFixed(2)}, 平均: ${avg.toFixed(2)}`,
          impact: `范围 ${Math.min(...values)} 到 ${Math.max(...values)}`,
          importance: 'low',
        });
      }
    }

    return insights;
  }

  async _call(input) {
    const { sql, results, row_count, analysis_depth, context } = this.normalizeInput(input);

    try {
      if (!Array.isArray(results) || results.length === 0) {
        return JSON.stringify(
          {
            summary: '结果分析失败：缺少 results（或 data.rows）',
            error:
              '请传入行数组 {"results":[...]} 或 {"data":{"rows":[...]}}。' +
              '本工具只解读快照；波动/下钻请用 fluctuation-attribution。',
            metadata: { row_count: 0, column_count: 0, analysis_confidence: 0 },
          },
          null,
          2,
        );
      }

      const fieldTypes = this.classifyFields(results);
      const rowCount = results.length || row_count || 0;
      const columns = Object.keys(results[0] || {});
      const contextHint = context ? ` 业务上下文：${context}` : '';
      const sqlHint = sql ? '（已附带 SQL 文本，未执行）' : '';

      const analysisResult = { results, fieldTypes };
      const result = {
        summary: `查询返回了 ${rowCount} 行、${columns.length} 列。${sqlHint}${contextHint}`.trim(),
        metadata: {
          row_count: rowCount,
          column_count: columns.length,
          field_types: fieldTypes,
          analysis_depth,
        },
      };

      if (analysis_depth !== 'basic' && fieldTypes.numericFields.length > 0) {
        const stats = this.performStatisticalAnalysis(results, fieldTypes.numericFields);
        result.statistics = stats;
        analysisResult.stats = stats;
      }

      if (analysis_depth !== 'basic' && results.length >= 4) {
        const anomalies = this.detectAnomalies(results, fieldTypes.numericFields);
        if (anomalies.length > 0) result.anomalies = anomalies;
        analysisResult.anomalies = anomalies;
      }

      if (fieldTypes.timeFields.length > 0 && fieldTypes.numericFields.length > 0) {
        const trends = this.detectTimeTrend(
          results,
          fieldTypes.timeFields[0],
          fieldTypes.numericFields,
        );
        if (trends) {
          result.time_trends = trends;
          analysisResult.trends = trends;
        }
      }

      if (analysis_depth === 'deep' && fieldTypes.numericFields.length >= 2) {
        const correlation = this.performCorrelationAnalysis(results, fieldTypes.numericFields);
        if (correlation) {
          result.correlation = correlation;
          analysisResult.correlation = correlation;
        }
      }

      result.key_insights = this._generateKeyInsights(analysisResult);
      result.metadata.analysis_confidence = Math.min(
        0.95,
        0.4 +
          (result.statistics ? 0.2 : 0) +
          (result.anomalies ? 0.15 : 0) +
          (result.time_trends ? 0.15 : 0) +
          (result.correlation ? 0.1 : 0),
      );

      logger.info('[ResultAnalysisTool] 分析完成:', {
        rowCount,
        insightsCount: result.key_insights?.length || 0,
        hasAnomalies: !!result.anomalies,
        hasTrends: !!result.time_trends,
      });

      return JSON.stringify(result, null, 2);
    } catch (error) {
      logger.error('[ResultAnalysisTool] 分析失败:', error);
      return JSON.stringify(
        {
          summary: '结果分析失败',
          error: error.message,
          metadata: {
            row_count: results?.length || row_count || 0,
            column_count: 0,
            analysis_confidence: 0,
          },
        },
        null,
        2,
      );
    }
  }
}

module.exports = ResultAnalysisTool;
