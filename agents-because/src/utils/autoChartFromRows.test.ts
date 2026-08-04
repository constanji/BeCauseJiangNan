import {
  detectChartability,
  buildAutoCharts,
  parseJsonArrayPrefix,
  extractFromBecauseJn,
  extractFromAskData,
  isAutoChartTriggerTool,
  isAutoChartPipelineGloballyEnabled,
} from './autoChartFromRows';

describe('autoChartFromRows', () => {
  it('detects bar for dimension compare', () => {
    const rows = [
      { org_name: '江南农商行', 资产规模: 5804 },
      { org_name: '招商行', 资产规模: 58040 },
    ];
    expect(detectChartability(rows)?.type).toBe('bar');
  });

  it('detects line for multi-period dates', () => {
    const rows = [
      { data_dt: '2024-11-25', value: 1 },
      { data_dt: '2025-09-30', value: 2 },
    ];
    expect(detectChartability(rows)?.type).toBe('line');
  });

  it('detects line for single-row time compare fields', () => {
    const rows = [
      {
        index_name: '贷款余额',
        value: 100,
        yd_value: 90,
        m_begin_value: 80,
        ly_value: 70,
      },
    ];
    const result = detectChartability(rows);
    expect(result?.type).toBe('line');
    if (result?.type === 'line') {
      expect(result.timeCompareCols?.length).toBeGreaterThan(0);
    }
  });

  it('returns null when not chartable', () => {
    expect(detectChartability([{ org_name: 'A', value: 1 }])).toBeNull();
  });

  it('buildAutoCharts produces series', () => {
    const charts = buildAutoCharts(
      [
        { org_name: 'A', value: 10 },
        { org_name: 'B', value: 20 },
      ],
      undefined,
      'auto_1',
    );
    expect(charts?.[0].echartsOption.series).toBeDefined();
    expect(charts?.[0].id).toBe('auto_1');
  });

  it('extracts because_jn sql-executor output', () => {
    const table = extractFromBecauseJn(
      'because_jn',
      { command: 'sql-executor' },
      JSON.stringify({
        success: true,
        rows: [{ a: 1 }, { a: 2 }],
        columns: ['a'],
      }),
    );
    expect(table?.rows).toHaveLength(2);
  });

  it('extracts ask_data Query Results', () => {
    const content =
      'SQL: SELECT 1\nQuery Results: [{"x":1,"data_dt":"2024-01"},{"x":2,"data_dt":"2024-02"}]\nDONE';
    const table = extractFromAskData('ask_data', {}, content);
    expect(table?.rows).toHaveLength(2);
  });

  it('parseJsonArrayPrefix stops at matching bracket', () => {
    expect(parseJsonArrayPrefix('[{"a":1}] junk')).toEqual([{ a: 1 }]);
  });

  it('trigger tool matcher', () => {
    expect(isAutoChartTriggerTool('because_jn')).toBe(true);
    expect(isAutoChartTriggerTool('ask_data_mcp_x')).toBe(true);
    expect(isAutoChartTriggerTool('calculator')).toBe(false);
  });

  it('global kill switch', () => {
    const prev = process.env.AUTO_CHART_PIPELINE_ENABLED;
    try {
      process.env.AUTO_CHART_PIPELINE_ENABLED = 'off';
      expect(isAutoChartPipelineGloballyEnabled()).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.AUTO_CHART_PIPELINE_ENABLED;
      } else {
        process.env.AUTO_CHART_PIPELINE_ENABLED = prev;
      }
    }
  });
});
