const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');

/** 金融指标对比柱状图默认配色（对齐 echarts.html 规范） */
const BAR_PALETTE = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452'];

/**
 * 粗略判断一段文本是否疑似因模型输出长度受限而被截断（括号未闭合等），
 * 用于给出比"缺少数组"更有指导性的报错，帮助模型（尤其是低质量模型）自行纠正。
 */
function looksLikeTruncatedJson(text) {
  const opens = (text.match(/[{[]/g) || []).length;
  const closes = (text.match(/[}\]]/g) || []).length;
  if (opens > closes) {
    return true;
  }
  const lastChar = text[text.length - 1];
  return text.length > 50 && lastChar !== '}' && lastChar !== ']' && lastChar !== '"';
}

/**
 * 部分模型会把 charts 整段序列化成 JSON 字符串（常见前缀 \\n\\n），
 * 或在 because_skills_2 的 arguments 习惯影响下误传 string，
 * 也可能因为单图数据量过大导致输出中途被截断成不完整 JSON。
 * 在 Zod 校验前尽量还原为数组，避免 Expected array, received string；
 * 无法还原时返回明确、可指导模型重试的错误信息。
 *
 * @returns {{ charts: Array|null, error: string|null }}
 */
function parseChartsInput(value) {
  if (Array.isArray(value)) {
    return { charts: value, error: null };
  }
  if (typeof value !== 'string') {
    return { charts: null, error: null };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { charts: null, error: null };
  }

  const tryParse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(trimmed);
  if (parsed == null) {
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      parsed = tryParse(arrayMatch[0]);
    }
  }

  if (Array.isArray(parsed)) {
    return { charts: parsed, error: null };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.charts)) {
    return { charts: parsed.charts, error: null };
  }

  if (looksLikeTruncatedJson(trimmed)) {
    return {
      charts: null,
      error:
        'charts 解析失败，疑似因单次输出内容过长在生成 JSON 过程中被截断（括号未闭合）。' +
        '请减少本次图表数量或精简单图 data（先聚合/取 Top N），必要时分多次调用本工具。',
    };
  }

  return {
    charts: null,
    error: 'charts 必须是图表配置对象数组，或可解析为该数组的 JSON 字符串（不要多层转义/多次序列化）。',
  };
}

/**
 * 深度合并：仅在目标缺字段时用默认值补齐，不覆盖模型已显式传入的配置。
 */
function deepFillDefaults(target, defaults) {
  if (target == null) {
    return defaults;
  }
  if (Array.isArray(defaults)) {
    return Array.isArray(target) ? target : defaults;
  }
  if (typeof defaults !== 'object' || defaults === null) {
    return target;
  }
  if (typeof target !== 'object' || Array.isArray(target)) {
    return target;
  }
  const result = { ...target };
  for (const [key, defVal] of Object.entries(defaults)) {
    if (result[key] === undefined || result[key] === null) {
      result[key] = defVal;
    } else if (
      typeof defVal === 'object' &&
      defVal !== null &&
      !Array.isArray(defVal) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepFillDefaults(result[key], defVal);
    }
  }
  return result;
}

function getPrimarySeriesType(option) {
  const series = option?.series;
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }
  return series[0]?.type || null;
}

/**
 * 按 echarts.html 金融指标规范补齐默认样式：
 * - 柱状对比：双色板、shadow tooltip、legend、grid
 * - 折线趋势：日期轴 rotate、boundaryGap:false、markPoint max/min、markLine average
 * - 通用：title 居中、tooltip confine、yAxis 单位名
 */
function applyFinancialStyleDefaults(option, title) {
  const chartType = getPrimarySeriesType(option);
  let next = { ...option };

  // title：外层 title 写入 option.title.text（若缺失）
  if (title) {
    if (!next.title || typeof next.title !== 'object') {
      next.title = { left: 'center', text: title };
    } else {
      next.title = {
        left: next.title.left ?? 'center',
        ...next.title,
        text: next.title.text || title,
      };
    }
  }

  if (chartType === 'bar') {
    next = deepFillDefaults(next, {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
      legend: { top: '10%' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '22%', containLabel: true },
      yAxis: { type: 'value' },
      xAxis: { type: 'category' },
    });

    if (Array.isArray(next.series)) {
      next.series = next.series.map((s, i) => {
        if (!s || typeof s !== 'object') {
          return s;
        }
        const color = BAR_PALETTE[i % BAR_PALETTE.length];
        const itemStyle = s.itemStyle && typeof s.itemStyle === 'object' ? { ...s.itemStyle } : {};
        if (!itemStyle.color) {
          itemStyle.color = color;
        }
        return { ...s, itemStyle };
      });

      // legend.data 缺省时用 series.name
      if (!next.legend) {
        next.legend = { top: '10%' };
      }
      if (!Array.isArray(next.legend.data) || next.legend.data.length === 0) {
        const names = next.series.map((s) => s?.name).filter(Boolean);
        if (names.length > 0) {
          next.legend = { ...next.legend, data: names };
        }
      }
    }
  } else if (chartType === 'line') {
    next = deepFillDefaults(next, {
      tooltip: { trigger: 'axis', confine: true },
      legend: { left: 'right' },
      grid: { left: '3%', bottom: '3%', right: '4%', containLabel: true },
      yAxis: { type: 'value' },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        axisLabel: { rotate: 45 },
      },
    });

    if (Array.isArray(next.series)) {
      next.series = next.series.map((s) => {
        if (!s || typeof s !== 'object') {
          return s;
        }
        const patched = { ...s };
        if (!patched.markPoint) {
          patched.markPoint = { data: [{ type: 'max' }, { type: 'min' }] };
        }
        if (!patched.markLine) {
          patched.markLine = { data: [{ type: 'average' }] };
        }
        return patched;
      });

      if (!next.legend) {
        next.legend = { left: 'right' };
      }
      if (!Array.isArray(next.legend.data) || next.legend.data.length === 0) {
        const names = next.series.map((s) => s?.name).filter(Boolean);
        if (names.length > 0) {
          next.legend = { ...next.legend, data: names };
        }
      }
    }
  } else {
    // pie / 其它：至少补 tooltip
    next = deepFillDefaults(next, {
      tooltip: { trigger: 'item', confine: true },
    });
  }

  // toolbox：推荐 saveAsImage（不强制覆盖已有 toolbox）
  if (!next.toolbox) {
    next.toolbox = {
      feature: {
        saveAsImage: { title: '保存为图片' },
      },
    };
  }

  return next;
}

const chartItemSchema = z.object({
  id: z
    .string()
    .describe(
      '图表唯一标识（如 chart_1）。正文占位必须写成 @ec@<图型>:<此id>@ec@，例如 id=chart_1 且为折线 → @ec@line:chart_1@ec@；' +
        '图型取 series[0].type（bar/line/pie）。禁止把 analysisType 写进占位。',
    ),
  title: z
    .string()
    .describe(
      '图表标题，需具备业务洞察力，如"2025年9月两家银行指标数据对比"、"各项贷款余额(人行口径)趋势图"',
    ),
  echartsOption: z
    .union([z.string(), z.record(z.any())])
    .describe(
      '完整的 ECharts Option JSON 配置（可以是 JSON 字符串或对象）。' +
        '必须包含 series（系列数据数组）以及对应的 xAxis/yAxis 或其它坐标系配置。' +
        '样式规范见工具 description（对齐金融指标 echarts.html）。',
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
      '业务场景标签（可选，仅元数据，不参与正文占位匹配）：' +
        'dimension_compare / trend_analysis / combined_analysis / composition_distribution / general。' +
        '切勿写成 @ec@trend_analysis@ec@ —— 占位必须用 @ec@line:chart_1@ec@ 这种 type:id 形式。',
    ),
});

/**
 * EChartsGeneratorAPP Tool - ECharts 多图生成工具
 *
 * 接收 LLM 生成的 ECharts Option JSON 配置数组，验证后按金融指标样式规范补齐默认配置，
 * 返回供前端按 @ec@ 标记内联渲染。
 */
class EChartsGeneratorAPP extends Tool {
  name = 'echarts_generator_app';

  description =
    'ECharts 图表生成工具。传入 charts 数组（每项含 id、title、echartsOption）生成交互式图表。\n\n' +
    '## 正文占位约定（本工具特有，必须遵守）\n' +
    '- 调用本工具后，Agent 须在回复正文插入：`@ec@<type>:<id>@ec@`\n' +
    '- `<type>` = 图型，取 series[0].type：`bar` / `line` / `pie`\n' +
    '- `<id>` = 本调用 charts[].id（如 chart_1），须逐字一致\n' +
    '- ✅ `@ec@line:chart_1@ec@`  `@ec@bar:chart_2@ec@`\n' +
    '- ❌ `@ec@trend_analysis@ec@`（误用 analysisType）  ❌ `@ec@chart_1@ec@`（缺 type）\n' +
    '- analysisType 只是业务标签，不参与占位匹配\n\n' +
    '**参数格式**：charts 必须是 JSON 数组（[{id,title,echartsOption},...]），不要传 JSON 字符串。\n\n' +
    '支持类型：柱状图(bar)、折线图(line)优先；饼图/环图仅在构成占比场景使用。\n\n' +
    '## 图表生成规则（强制执行）\n\n' +
    '### 1. 何时必须画图\n' +
    '- 数据有 ≥2 行且存在维度字段（机构/地区等）有 ≥2 个不同值 → 柱状对比图\n' +
    '- 数据只有 1 行但含时间对比字段（yd_value/m_begin_value/q_begin_value/y_begin_value/ly_value）→ 折线趋势图\n' +
    '- ≥2 行且含 data_dt 多期 → 折线趋势图\n' +
    '- 1 行且无时间对比字段 → 禁止画图\n\n' +
    '### 2. 数据真实性\n' +
    '- 数值必须来自 sql-executor，禁止编造/估算\n' +
    '- 字段名用中文；严禁 emoji\n' +
    '- 图表 series[].data 使用 SQL 原始万元值；yAxis.name 标注「万元」或「数值（万元）」；' +
    '若文字侧已按量级统一换算为亿元，图表仍保持万元原值（与文字单位可不同）\n' +
    '- 占比类指标 yAxis.name 用「单位：百分比」或「%」\n\n' +
    '### 3. 金融指标样式规范（对齐 echarts.html，工具会自动补缺省项）\n' +
    '**柱状对比图（bar）**：\n' +
    '- tooltip: { trigger:"axis", axisPointer:{ type:"shadow" }, confine:true }\n' +
    '- legend: { data:[系列名...], top:"10%" }\n' +
    '- grid: { left:"3%", right:"4%", bottom:"3%", top:"22%", containLabel:true }\n' +
    '- series[].itemStyle.color 按序使用 #5470c6 / #91cc75 / #fac858 / #ee6666 …\n' +
    '- title: { left:"center", text:"…" }\n\n' +
    '**折线趋势图（line）**：\n' +
    '- tooltip: { trigger:"axis", confine:true }\n' +
    '- xAxis: { type:"category", boundaryGap:false, axisLabel:{ rotate:45 } }\n' +
    '- legend: { data:[指标名], left:"right" }\n' +
    '- grid: { left:"3%", bottom:"3%", right:"4%", containLabel:true }\n' +
    '- series 建议带 markPoint:{ data:[{type:"max"},{type:"min"}] } 与 markLine:{ data:[{type:"average"}] }\n' +
    '- title: { left:"center", text:"…趋势图" }\n\n' +
    '**通用**：推荐 toolbox.feature.saveAsImage；数据点多时加 dataZoom。\n\n' +
    '### 4. 配套表格（不由本工具返回）\n' +
    '- 时间对比/增量增幅明细用正文 markdown 表格展示（列：时间维度、当前值、增量、增幅）\n' +
    '- 增量/增幅：上涨标红语义、下跌标绿语义（文字说明即可）；正数可加「+」前缀\n' +
    '- 本工具只负责 echarts 配置，不要把 tableColumns 塞进 charts\n\n' +
    '### 5. Option 最少字段\n' +
    '- 必须含 series 与坐标系（xAxis/yAxis 等）；series[0].type 必填（bar/line/pie）\n' +
    '- 参考：https://echarts.apache.org/zh/option.html';

  schema = z.object({
    charts: z
      .union([
        chartItemSchema.array().min(1),
        z.string().min(1),
      ])
      .describe(
        '图表配置数组，每个图表配置包含 id、title、echartsOption。兼容少数模型误把数组序列化成 JSON 字符串的情况。',
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
        // 丢弃不可序列化的函数字符串（HTML 规范里的 formatter 函数由前端处理）
        if (typeof value === 'function') {
          continue;
        }
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
    echartsOption = applyFinancialStyleDefaults(echartsOption, title);

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

      const { charts, error: parseError } = parseChartsInput(input?.charts);

      if (!charts || !Array.isArray(charts) || charts.length === 0) {
        return JSON.stringify(
          {
            success: false,
            error:
              parseError ||
              '缺少图表配置数组（charts），charts 必须是数组，或可解析为数组的 JSON 字符串',
          },
          null,
          2,
        );
      }

      // 单个图表配置有误不应拖累整批：逐个处理，收集失败项，
      // 只要至少一个图表成功就返回部分结果，让模型看到具体哪个/为何失败。
      const processedCharts = [];
      const failedCharts = [];
      for (let i = 0; i < charts.length; i++) {
        try {
          const processedChart = this.processChart(charts[i], i);
          processedCharts.push(processedChart);
        } catch (chartErr) {
          failedCharts.push({
            index: i,
            id: typeof charts[i]?.id === 'string' ? charts[i].id : undefined,
            error: chartErr.message,
          });
        }
      }

      const duration = Date.now() - startTime;

      if (processedCharts.length === 0) {
        logger.error(
          `[EChartsGeneratorAPP] 全部 ${charts.length} 个图表均生成失败, 耗时: ${duration}ms`,
        );
        return JSON.stringify(
          {
            success: false,
            error: failedCharts[0]?.error || '图表配置生成失败',
            failedCharts,
          },
          null,
          2,
        );
      }

      logger.info(
        `[EChartsGeneratorAPP] ECharts 图表配置生成完成, 成功 ${processedCharts.length}/${charts.length}, 耗时: ${duration}ms`,
      );
      logger.info('[EChartsGeneratorAPP] ========== 调用完成 ==========');

      return JSON.stringify(
        {
          success: true,
          __echartsConfig: true,
          charts: processedCharts,
          ...(failedCharts.length > 0 ? { partial: true, failedCharts } : {}),
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
module.exports.parseChartsInput = parseChartsInput;
module.exports.applyFinancialStyleDefaults = applyFinancialStyleDefaults;
module.exports.BAR_PALETTE = BAR_PALETTE;
