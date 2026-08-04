const {
  detectChartability,
  buildAutoCharts,
  parseJsonArrayPrefix,
  extractFromBecauseJn,
  extractFromAskData,
  isAutoChartTriggerTool,
  isAutoChartPipelineGloballyEnabled,
} = require('./autoChartFromRows');

describe('autoChartFromRows', () => {
  describe('detectChartability', () => {
    it('returns bar for multi-row dimension compare', () => {
      const rows = [
        { org_name: '江南农商行', 资产规模: 5804, 贷款规模: 3866 },
        { org_name: '招商行', 资产规模: 58040, 贷款规模: 38660 },
      ];
      const result = detectChartability(rows);
      expect(result).toMatchObject({
        type: 'bar',
        analysisType: 'dimension_compare',
        dimCol: 'org_name',
      });
      expect(result.measureCols.length).toBeGreaterThanOrEqual(1);
    });

    it('returns line for multi-period data_dt', () => {
      const rows = [
        { data_dt: '2024-11-25', value: 3733.7 },
        { data_dt: '2024-12-31', value: 3720.51 },
        { data_dt: '2025-09-30', value: 3866.46 },
      ];
      const result = detectChartability(rows);
      expect(result).toMatchObject({
        type: 'line',
        analysisType: 'trend_analysis',
        dateCol: 'data_dt',
      });
    });

    it('returns line for single row with time-compare fields', () => {
      const rows = [
        {
          index_name: '各项贷款余额',
          value: 3878.41,
          yd_value: 3871.64,
          m_begin_value: 3871.36,
          y_begin_value: 3720.51,
          ly_value: 3733.7,
        },
      ];
      const result = detectChartability(rows);
      expect(result).toMatchObject({
        type: 'line',
        analysisType: 'trend_analysis',
      });
      expect(result.timeCompareCols.length).toBeGreaterThanOrEqual(1);
    });

    it('returns null for single row without time-compare', () => {
      const rows = [{ org_name: '江南农商行', value: 100 }];
      expect(detectChartability(rows)).toBeNull();
    });

    it('returns null for empty rows', () => {
      expect(detectChartability([])).toBeNull();
    });
  });

  describe('buildAutoCharts', () => {
    it('builds a valid bar chart option', () => {
      const rows = [
        { org_name: 'A', value: 10 },
        { org_name: 'B', value: 20 },
      ];
      const charts = buildAutoCharts(rows, undefined, 'chart_1');
      expect(charts).toHaveLength(1);
      expect(charts[0].id).toBe('chart_1');
      expect(charts[0].echartsOption.series[0].type).toBe('bar');
      expect(charts[0].echartsOption.xAxis.data).toEqual(['A', 'B']);
    });

    it('builds a valid line chart for date series', () => {
      const rows = [
        { data_dt: '2024-01', value: 1 },
        { data_dt: '2024-02', value: 2 },
      ];
      const charts = buildAutoCharts(rows, undefined, 'auto_x');
      expect(charts[0].echartsOption.series[0].type).toBe('line');
      expect(charts[0].echartsOption.series[0].markPoint).toBeDefined();
    });
  });

  describe('adapters', () => {
    it('extractFromBecauseJn parses sql-executor JSON', () => {
      const content = JSON.stringify({
        success: true,
        rows: [
          { org_name: 'A', value: 1 },
          { org_name: 'B', value: 2 },
        ],
        columns: ['org_name', 'value'],
      });
      const table = extractFromBecauseJn(
        'because_jn',
        { command: 'sql-executor' },
        content,
      );
      expect(table.rows).toHaveLength(2);
      expect(table.columns).toEqual(['org_name', 'value']);
    });

    it('extractFromBecauseJn ignores non sql-executor', () => {
      expect(
        extractFromBecauseJn('because_jn', { command: 'rag-retrieval' }, '{}'),
      ).toBeNull();
    });

    it('extractFromAskData parses Query Results block', () => {
      const content = [
        '--------------------- sql_execute ---------------------',
        'Query Results: [{"机构":"江南银行","指标值":123.4,"数据日期":"2024-12-31"},{"机构":"江南银行","指标值":200,"数据日期":"2025-01-31"}]',
        '--------------------- data_assistance ---------------------',
        '自然语言总结',
      ].join('\n');
      const table = extractFromAskData('ask_data_mcp_becauseai-server', {}, content);
      expect(table.rows).toHaveLength(2);
      expect(table.columns).toContain('机构');
    });

    it('parseJsonArrayPrefix handles nested objects', () => {
      const text = '[{"a":[1,2]},{"b":3}] trailing';
      expect(parseJsonArrayPrefix(text)).toEqual([{ a: [1, 2] }, { b: 3 }]);
    });
  });

  describe('gates', () => {
    it('isAutoChartTriggerTool matches because_jn and ask_data*', () => {
      expect(isAutoChartTriggerTool('because_jn')).toBe(true);
      expect(isAutoChartTriggerTool('ask_data')).toBe(true);
      expect(isAutoChartTriggerTool('ask_data_mcp_becauseai-server')).toBe(true);
      expect(isAutoChartTriggerTool('echarts_generator_app')).toBe(false);
    });

    it('isAutoChartPipelineGloballyEnabled respects env kill switch', () => {
      const prev = process.env.AUTO_CHART_PIPELINE_ENABLED;
      try {
        delete process.env.AUTO_CHART_PIPELINE_ENABLED;
        expect(isAutoChartPipelineGloballyEnabled()).toBe(true);
        process.env.AUTO_CHART_PIPELINE_ENABLED = 'false';
        expect(isAutoChartPipelineGloballyEnabled()).toBe(false);
        process.env.AUTO_CHART_PIPELINE_ENABLED = '0';
        expect(isAutoChartPipelineGloballyEnabled()).toBe(false);
        process.env.AUTO_CHART_PIPELINE_ENABLED = 'true';
        expect(isAutoChartPipelineGloballyEnabled()).toBe(true);
      } finally {
        if (prev === undefined) {
          delete process.env.AUTO_CHART_PIPELINE_ENABLED;
        } else {
          process.env.AUTO_CHART_PIPELINE_ENABLED = prev;
        }
      }
    });
  });
});
