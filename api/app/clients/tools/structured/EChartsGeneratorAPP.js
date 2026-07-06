const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');

/**
 * EChartsGeneratorAPP Tool - ECharts 多图生成工具
 *
 * 接收 LLM 生成的 ECharts Option JSON 配置数组，验证后返回配置供前端按 @ec@ 标记内联渲染。
 */
class EChartsGeneratorAPP extends Tool {
  name = 'echarts_generator_app';

  description =
    'ECharts 图表生成工具。传入 charts 数组（每项含 id、title、echartsOption）生成交互式图表，' +
    '前端根据 id 匹配正文中的 @ec@type:id@ec@ 标记位置渲染。\n\n' +
    '支持类型：柱状图、折线图、面积图、饼图/环图、散点图、雷达图、热力图、漏斗图、仪表盘、瀑布图、箱线图、桑基图、旭日图、地图等。\n\n' +
    '## 图表生成规则（强制执行，违反任何一条视为违规）\n\n' +
    '### 1. 何时必须画图（按顺序判断，命中即执行）\n' +
    '- 数据有 ≥2 行且存在维度字段（brchna/地区/渠道等）有 ≥2 个不同值 → 必须画图\n' +
    '- 数据只有 1 行但包含时间对比字段（yd_value/m_begin_value/q_begin_value/y_begin_value/ly_value 任意一个非空）→ 必须画图\n' +
    '- 数据只有 1 行且无任何时间对比字段 → 禁止画图，告知用户数据粒度不足\n\n' +
    '### 2. 数据真实性（最高优先级，严禁违反）\n' +
    '- 图表数值必须原封不动来自 sql-executor 返回结果\n' +
    '- 严禁：把合计值除以N估算、凭空编造数据行、拆分汇总行凑图\n' +
    '- 1行合计且无时间对比字段 → 不画图，告知用户\n' +
    '- 严禁使用任何 emoji 表情符号\n\n' +
    '### 3. 字段命名与交互\n' +
    '- 图表数据字段名必须使用中文，禁止展示数据库原始英文字段名\n' +
    '- 标题需具备业务洞察力\n' +
    '- 必须配置 tooltip（提示框）\n' +
    '- 推荐配置 toolbox（至少含 saveAsImage）\n' +
    '- 数据量大时推荐 dataZoom\n\n' +
    '### 4. ECharts Option 格式要点\n' +
    '- 必须包含 series（系列数组）和对应坐标系（xAxis/yAxis 等）\n' +
    '- series 中每个系列的 type 指定图表类型\n' +
    '- 参考标准格式：https://echarts.apache.org/zh/option.html';

  schema = z.object({
    charts: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              '图表唯一标识，用于前端解析匹配（如 chart_1, chart_2 等），对应 markdown 中的 @ec@type:id@ec@ 标记',
            ),
          title: z
            .string()
            .describe(
              '图表标题，需具备业务洞察力，如"二线城市是本月销售下滑的重灾区"而非"各地区销售数据"',
            ),
          echartsOption: z
            .union([z.string(), z.record(z.any())])
            .describe(
              '完整的 ECharts Option JSON 配置（可以是 JSON 字符串或对象）。' +
                '必须包含 series（系列数据数组）以及对应的 xAxis/yAxis 或其它坐标系配置。',
            ),
          analysisType: z
            .enum([
              'dimension_compare',
              'trend_analysis',
              'combined_analysis',
              'composition_distribution',
              'general',
            ])
            .optional()
            .describe(
              '归因分析场景类型（可选）：' +
                'dimension_compare=多维度对比分析, trend_analysis=同比/环比趋势分析, ' +
                'combined_analysis=多维度+时间轴组合归因, composition_distribution=指标构成/分布归因, ' +
                'general=通用图表',
            ),
        }),
      )
      .min(1)
      .describe(
        '图表配置数组，每个图表配置包含 id、title、echartsOption，前端根据 id 匹配对应的图表位置',
      ),
  });

  constructor(fields = {}) {
    super();
  }

  validateEChartsOption(option) {
    if (!option || typeof option !== 'object') {
      throw new Error('echartsOption 必须是有效的 JSON 对象');
    }

    if (!option.series) {
      throw new Error('echartsOption 必须包含 series 字段');
    }

    if (!Array.isArray(option.series)) {
      throw new Error('series 必须是数组');
    }

    if (option.series.length === 0) {
      throw new Error('series 数组不能为空');
    }

    for (let i = 0; i < option.series.length; i++) {
      const s = option.series[i];
      if (!s || typeof s !== 'object') {
        throw new Error(`series[${i}] 必须是有效的对象`);
      }
      if (!s.type && !s.data) {
        throw new Error(`series[${i}] 必须包含 type 字段（如 bar, line, pie 等）`);
      }
    }

    return true;
  }

  sanitizeOption(option) {
    if (option === null || option === undefined) {
      return option;
    }
    if (Array.isArray(option)) {
      return option.map((item) => this.sanitizeOption(item));
    }
    if (typeof option === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(option)) {
        result[key] = this.sanitizeOption(value);
      }
      return result;
    }
    return option;
  }

  processChart(chart, index) {
    const { id, title, echartsOption: rawOption, analysisType } = chart;

    if (!id || typeof id !== 'string') {
      throw new Error(`charts[${index}] 缺少图表标识（id）`);
    }

    if (!title || typeof title !== 'string') {
      throw new Error(`charts[${id}] 缺少图表标题（title）`);
    }

    let echartsOption;
    if (typeof rawOption === 'string') {
      try {
        echartsOption = JSON.parse(rawOption);
      } catch (parseErr) {
        throw new Error(`charts[${id}] echartsOption JSON 解析失败: ${parseErr.message}`);
      }
    } else {
      echartsOption = rawOption;
    }

    if (!echartsOption || typeof echartsOption !== 'object') {
      throw new Error(`charts[${id}] echartsOption 必须是有效的 JSON 对象或 JSON 字符串`);
    }

    this.validateEChartsOption(echartsOption);
    echartsOption = this.sanitizeOption(echartsOption);

    return {
      id,
      title,
      analysisType: analysisType || 'general',
      echartsOption,
    };
  }

  async _call(input) {
    const startTime = Date.now();

    try {
      logger.info('[EChartsGeneratorAPP] ========== 开始调用 ==========');
      logger.info(`[EChartsGeneratorAPP] 输入参数: ${JSON.stringify(input, null, 2)}`);

      const { charts } = input;

      if (!charts || !Array.isArray(charts) || charts.length === 0) {
        return JSON.stringify({ success: false, error: '缺少图表配置数组（charts）' }, null, 2);
      }

      const processedCharts = [];
      for (let i = 0; i < charts.length; i++) {
        try {
          const processedChart = this.processChart(charts[i], i);
          processedCharts.push(processedChart);
        } catch (chartErr) {
          return JSON.stringify({ success: false, error: chartErr.message }, null, 2);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(
        `[EChartsGeneratorAPP] ECharts 图表配置生成成功, 共 ${processedCharts.length} 个图表, 耗时: ${duration}ms`,
      );
      logger.info('[EChartsGeneratorAPP] ========== 调用完成 ==========');

      return JSON.stringify(
        {
          success: true,
          __echartsConfig: true,
          charts: processedCharts,
        },
        null,
        2,
      );
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(
        `[EChartsGeneratorAPP] 执行错误: ${err.message}, 耗时: ${duration}ms`,
      );
      return JSON.stringify(
        { success: false, error: err.message || '图表配置生成失败' },
        null,
        2,
      );
    }
  }
}

module.exports = EChartsGeneratorAPP;
