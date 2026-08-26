import {
  detectChartability,
  matchAutoChartData,
  buildAutoCharts,
  parseJsonArrayPrefix,
  extractFromBecauseJn,
  extractFromAskData,
  unwrapJsonEncodedText,
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

  it('detects bar for multi-org data without relying on question wording', () => {
    const rows = [
      { org_name: '总行', index_value: 125050 },
      { org_name: '武进分行', index_value: 82030 },
      { org_name: '金坛分行', index_value: 69320 },
    ];
    const detected = detectChartability(rows, undefined, '各机构存款余额占比');
    expect(detected?.type).toBe('bar');

    const charts = buildAutoCharts(
      rows,
      undefined,
      'chart_1',
      '各机构存款余额占比'
    );
    expect(charts?.[0]).toMatchObject({
      analysisType: 'dimension_compare',
    });
    expect(
      (charts?.[0].echartsOption.series as Array<Record<string, unknown>>)[0]
        .type
    ).toBe('bar');
  });

  it('defaults same-period multi-org data to bar', () => {
    const result = matchAutoChartData(
      [
        { org_code: 'A0008', brchna: '金坛支行', index_value: 4558628.599004 },
        { org_code: 'A0009', brchna: '溧阳支行', index_value: 7852121.095636 },
      ],
      ['org_code', 'brchna', 'index_value']
    );
    expect(result).toMatchObject({
      status: 'matched',
      rule: 'dimension_compare',
    });
    if (result.status === 'matched') {
      expect(result.chartability.type).toBe('bar');
      if (result.chartability.type === 'bar') {
        expect(result.chartability.dimCol).toBe('brchna');
      }
      expect(result.rows).toHaveLength(2);
    }
  });

  it('honors a disabled matching rule without treating it as parse failure', () => {
    const result = matchAutoChartData(
      [
        { org_name: 'A', index_value: 10 },
        { org_name: 'B', index_value: 20 },
      ],
      undefined,
      undefined,
      { dimension_compare: { enabled: false } }
    );
    expect(result).toMatchObject({
      status: 'disabled',
      rule: 'dimension_compare',
    });
  });

  it('prefers DAT institution names over org codes in legacy pie output', () => {
    const rows = [
      {
        index_number: 'BM10010048',
        standard_name: '各项存款余额(人行口径)',
        org_code: 'FR001',
        brchna: '总行',
        index_value: 125050,
      },
      {
        index_number: 'BM10010048',
        standard_name: '各项存款余额(人行口径)',
        org_code: 'A0001',
        brchna: '武进分行',
        index_value: 82030,
      },
    ];
    const chart = buildAutoCharts(
      rows,
      undefined,
      'chart_1',
      '各机构存款余额占比',
      { dimension_compare: { chart_type: 'pie' } }
    )?.[0];
    const series = chart?.echartsOption.series as Array<
      Record<string, unknown>
    >;
    expect(chart?.title).toBe('各项存款余额(人行口径)');
    expect(series[0].data).toEqual([
      { name: '总行', value: 125050 },
      { name: '武进分行', value: 82030 },
    ]);
  });

  it('detects line for multi-period dates', () => {
    const rows = [
      { data_dt: '2024-11-25', value: 1 },
      { data_dt: '2025-09-30', value: 2 },
    ];
    expect(detectChartability(rows)?.type).toBe('line');
  });

  it('detects line for single-row time compare fields with index_value', () => {
    const rows = [
      {
        index_name: '贷款余额',
        index_value: 100,
        yd_value: 90,
        m_begin_value: 80,
        ly_value: 70,
      },
    ];
    const result = detectChartability(rows);
    expect(result?.type).toBe('line');
    if (result?.type === 'line') {
      expect(result.timeCompareCols?.length).toBeGreaterThan(0);
      expect(result.currentValueCol).toBe('index_value');
    }
  });

  it('omits null baseline points before generating a single-row trend', () => {
    const result = matchAutoChartData([
      {
        index_name: '各项存款余额',
        index_value: 4673.12,
        ly_value: 4641.68,
        y_begin_value: 4451.03,
        q_begin_value: 4624.37,
        m_begin_value: 4593.12,
        yd_value: null,
      },
    ]);

    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.rule).toBe('baseline_compare');
      expect(result.rows).toEqual([
        { label: '上年同期', value: 4641.68 },
        { label: '上年末', value: 4451.03 },
        { label: '上季末', value: 4624.37 },
        { label: '上月末', value: 4593.12 },
        { label: '当前值', value: 4673.12 },
      ]);
    }
  });

  it('does not generate an incomplete trend with fewer than two finite points', () => {
    expect(
      matchAutoChartData([
        { index_name: '各项存款余额', index_value: 4673.12, yd_value: null },
      ]).status
    ).toBe('no_match');
  });

  it('skips single-row time compare when index_value is missing', () => {
    const rows = [
      {
        index_name: '贷款余额',
        value: 100,
        yd_value: 90,
        m_begin_value: 80,
      },
    ];
    expect(detectChartability(rows)).toBeNull();
  });

  it('ignores curr_code / mea_unit as measures', () => {
    const rows = [
      { org_name: 'A', index_value: 10, curr_code: 1, mea_unit: 2 },
      { org_name: 'B', index_value: 20, curr_code: 1, mea_unit: 2 },
    ];
    const result = detectChartability(rows);
    expect(result?.type).toBe('bar');
    if (result?.type === 'bar') {
      expect(result.measureCols).toEqual(['index_value']);
    }
  });

  it('returns null when not chartable', () => {
    expect(detectChartability([{ org_name: 'A', value: 1 }])).toBeNull();
  });

  it('honors dimension sorting for dimension compare charts', () => {
    const result = matchAutoChartData(
      [
        { org_name: 'B', index_value: 10 },
        { org_name: 'A', index_value: 20 },
      ],
      undefined,
      undefined,
      { dimension_compare: { sort: 'dimension_asc' } }
    );
    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.rows.map((row) => row.org_name)).toEqual(['A', 'B']);
    }
  });

  it('removes rows with null measures from dimension comparisons', () => {
    const result = matchAutoChartData([
      { org_name: 'A', index_value: 10 },
      { org_name: 'B', index_value: null },
      { org_name: 'C', index_value: 30 },
    ]);
    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.rows.map((row) => row.org_name).sort()).toEqual(['A', 'C']);
    }
  });

  it('matches multiple indicators from standard KPI fields', () => {
    const result = matchAutoChartData([
      { index_number: 'BM001', standard_name: '存款余额', index_value: 10 },
      { index_number: 'BM002', standard_name: '贷款余额', index_value: 20 },
    ]);
    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.rule).toBe('dimension_compare');
      expect(result.chartability.type).toBe('bar');
      if (result.chartability.type === 'bar') {
        expect(result.chartability.dimCol).toBe('standard_name');
      }
    }
  });

  it('does not chart arbitrary text dimensions outside institution and KPI fields', () => {
    expect(
      matchAutoChartData([
        { product: 'A', index_value: 10 },
        { product: 'B', index_value: 20 },
      ]).status
    ).toBe('no_match');
  });

  it('ignores question wording when matching KPI dimensions', () => {
    const result = matchAutoChartData(
      [
        { org_name: 'A', index_value: 10 },
        { org_name: 'B', index_value: 20 },
      ],
      undefined,
      '各机构占比'
    );
    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.rule).toBe('dimension_compare');
    }
  });

  it('buildAutoCharts produces series', () => {
    const charts = buildAutoCharts(
      [
        { org_name: 'A', value: 10 },
        { org_name: 'B', value: 20 },
      ],
      undefined,
      'auto_1'
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
      })
    );
    expect(table?.rows).toHaveLength(2);
  });

  it('extracts ask_data Query Results', () => {
    const content =
      'SQL: SELECT 1\nQuery Results: [{"x":1,"data_dt":"2024-01"},{"x":2,"data_dt":"2024-02"}]\nDONE';
    const table = extractFromAskData('ask_data', {}, content);
    expect(table?.rows).toHaveLength(2);
  });

  it('uses only the latest Query Results section from the current tool output', () => {
    const content = [
      'Query Results: [{"org_name":"stale","index_value":999}]',
      'intermediate log',
      'Query Results: [{"org_name":"A","index_value":1.1793},{"org_name":"B","index_value":32.44037},{"org_name":"C","index_value":8.5}]',
    ].join('\n');
    const table = extractFromAskData('ask_data', {}, content);
    expect(table?.rows).toEqual([
      { org_name: 'A', index_value: 1.1793 },
      { org_name: 'B', index_value: 32.44037 },
      { org_name: 'C', index_value: 8.5 },
    ]);
  });

  it('extracts JSON-stringified DAT ask_data output', () => {
    const raw = [
      'Query Results: [{"index_number":"BM10010048","data_dt":[2026,5,31,0,0],"index_value":49860525.166752,"m_begin_value":49041141.327802}]',
      '--------------------- similar_question ---------------------',
      '{"similar_indices":[]}',
    ].join('\n');
    const encoded = JSON.stringify(raw);

    expect(unwrapJsonEncodedText(encoded)).toBe(raw);
    const table = extractFromAskData(
      'ask_data_mcp_becauseai-server',
      {},
      encoded
    );
    expect(table?.rows).toHaveLength(1);
    expect(table?.rows[0]?.index_number).toBe('BM10010048');
    expect(table?.rows[0]?.m_begin_value).toBe(49041141.327802);
  });

  it('extracts DAT output with escaped fields but no outer JSON quotes', () => {
    const content = String.raw`Query Results: [{\"index_number\":\"BM10010048\",\"index_value\":49860525.166752,\"m_begin_value\":49041141.327802}]\n--------------------- similar_question ---------------------\n{\"similar_indices\":[]}`;
    const table = extractFromAskData(
      'ask_data_mcp_becauseai-server',
      {},
      content
    );

    expect(table?.rows).toHaveLength(1);
    expect(table?.rows[0]?.index_number).toBe('BM10010048');
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
