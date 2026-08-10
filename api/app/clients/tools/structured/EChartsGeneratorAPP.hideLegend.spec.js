jest.mock('@because/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const EChartsGeneratorAPP = require('./EChartsGeneratorAPP');

const simpleBar = {
  id: 'chart_1',
  title: '测试柱状图',
  type: 'bar',
  role: 'indicator',
  data: [
    { x: 'A', y: 1 },
    { x: 'B', y: 2 },
  ],
  xField: 'x',
  yFields: ['y'],
};

describe('EChartsGeneratorAPP hide_legend', () => {
  it('strips legend from simple-mode output when hide_legend is true', () => {
    const tool = new EChartsGeneratorAPP({
      chartConfig: { hide_legend: true, input_mode: 'simple' },
    });
    const result = tool.processChart(simpleBar, 0, {
      chartConfig: { hide_legend: true },
    });
    expect(result.echartsOption).toBeDefined();
    expect(result.echartsOption.legend).toBeUndefined();
    expect(result.echartsOption.series).toBeDefined();
  });

  it('keeps legend when hide_legend is false/absent', () => {
    const tool = new EChartsGeneratorAPP({ chartConfig: { input_mode: 'simple' } });
    const result = tool.processChart(simpleBar, 0, { chartConfig: {} });
    expect(result.echartsOption.legend).toBeDefined();
  });

  it('strips legend even when legacy echartsOption already includes one', () => {
    const tool = new EChartsGeneratorAPP({ chartConfig: { hide_legend: true } });
    const result = tool.processChart(
      {
        id: 'chart_2',
        title: '完整协议图',
        echartsOption: {
          legend: { data: ['系列A'], top: '10%' },
          series: [{ type: 'bar', name: '系列A', data: [1, 2] }],
        },
      },
      0,
      { chartConfig: { hide_legend: true } },
    );
    expect(result.echartsOption.legend).toBeUndefined();
  });
});

describe('EChartsGeneratorAPP simple pie', () => {
  it('builds a pie option and reports composition_distribution', () => {
    const tool = new EChartsGeneratorAPP({ chartConfig: { input_mode: 'simple' } });
    const result = tool.processChart(
      {
        id: 'chart_1',
        title: '各机构存款余额占比',
        type: 'pie',
        style: 'composition',
        role: 'indicator',
        data: [
          { org_name: '总行', index_value: 1250.5 },
          { org_name: '武进分行', index_value: 820.3 },
          { org_name: '金坛分行', index_value: 693.2 },
        ],
        xField: 'org_name',
        yFields: ['index_value'],
        unit: '亿元',
      },
      0,
      { chartConfig: {} },
    );

    expect(result.analysisType).toBe('composition_distribution');
    expect(result.echartsOption.series[0]).toMatchObject({
      type: 'pie',
      data: [
        { name: '总行', value: 1250.5 },
        { name: '武进分行', value: 820.3 },
        { name: '金坛分行', value: 693.2 },
      ],
    });
  });
});
