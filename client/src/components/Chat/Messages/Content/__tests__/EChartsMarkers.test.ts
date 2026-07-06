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

  it('parseEChartsToolOutput and buildEChartsChartsById', () => {
    const charts = parseEChartsToolOutput(sampleOutput);
    expect(charts?.[0]?.id).toBe('chart_1');
    expect(charts?.[0]?.title).toBe('测试图表');

    const map = buildEChartsChartsById([sampleOutput]);
    expect(map.get('chart_1')?.title).toBe('测试图表');
  });

  it('returns null for invalid tool output', () => {
    expect(parseEChartsToolOutput('not json')).toBeNull();
    expect(parseEChartsToolOutput(JSON.stringify({ success: false }))).toBeNull();
  });
});
