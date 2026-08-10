import {
  buildEChartsChartsById,
  hasEChartsMarkers,
  parseEChartsMarker,
  parseEChartsToolOutput,
  preprocessEChartsMarkers,
} from '../EChartsMarkers';

describe('EChartsMarkers', () => {
  const sampleOutput = JSON.stringify({
    success: true,
    __echartsConfig: true,
    charts: [
      {
        id: 'chart_1',
        title: '测试图表',
        analysisType: 'line',
        echartsOption: { series: [{ type: 'line', data: [1, 2, 3] }] },
      },
    ],
  });

  it('parseEChartsMarker supports type:id and id-only forms', () => {
    expect(parseEChartsMarker('@ec@line:chart_1@ec@')).toEqual({
      fullMatch: '@ec@line:chart_1@ec@',
      chartType: 'line',
      chartId: 'chart_1',
    });
    expect(parseEChartsMarker('@ec@chart_1@ec@')).toEqual({
      fullMatch: '@ec@chart_1@ec@',
      chartId: 'chart_1',
    });
  });

  it('hasEChartsMarkers and preprocessEChartsMarkers', () => {
    const text = '趋势如下：@ec@line:chart_1@ec@ 数据说明';
    expect(hasEChartsMarkers(text)).toBe(true);
    expect(preprocessEChartsMarkers(text)).toContain(
      '<div class="echarts-marker" data-chart-id="chart_1"></div>',
    );
  });

  it('renders the same chart id only once when marker types differ', () => {
    const text =
      '@ec@zb:chart_1@ec@\n\n@ec@line:chart_1@ec@\n\n分析正文';
    const processed = preprocessEChartsMarkers(text);

    expect(processed.match(/class="echarts-marker"/g)).toHaveLength(1);
    expect(processed).toContain('data-chart-id="chart_1"');
    expect(processed).toContain('分析正文');
  });

  it('parseEChartsToolOutput and buildEChartsChartsById', () => {
    const charts = parseEChartsToolOutput(sampleOutput);
    expect(charts?.[0]?.id).toBe('chart_1');
    expect(charts?.[0]?.title).toBe('测试图表');

    const map = buildEChartsChartsById([sampleOutput]);
    expect(map.get('chart_1')?.title).toBe('测试图表');
    // Only exact chart ids are indexed; marker type / analysisType is not an alias.
    expect(map.get('line')).toBeUndefined();
  });

  it('returns null for invalid tool output', () => {
    expect(parseEChartsToolOutput('not json')).toBeNull();
    expect(parseEChartsToolOutput(JSON.stringify({ success: false }))).toBeNull();
  });
});
