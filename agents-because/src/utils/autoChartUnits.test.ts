import { normalizeAutoChartUnits } from './autoChartUnits';

describe('normalizeAutoChartUnits', () => {
  it('converts majority large 万元 chart values to 亿元', () => {
    const charts = normalizeAutoChartUnits(
      [
        {
          role: 'indicator',
          type: 'line',
          data: [
            { label: '当前值', value: 49860525.166752 },
            { label: '上月末', value: 49041141.327802 },
          ],
          xField: 'label',
          yFields: ['value'],
          unit: '万元',
          title: '指标趋势图',
        },
      ],
      [{ mea_unit: '万元', index_value: 49860525.166752 }]
    ) as Array<Record<string, unknown>>;

    expect(charts[0].unit).toBe('亿元');
    expect((charts[0].data as Array<Record<string, number>>)[0].value).toBe(
      4986.05
    );
    expect((charts[0].data as Array<Record<string, number>>)[1].value).toBe(
      4904.11
    );
  });

  it('keeps small 万元 values unchanged', () => {
    const chart = normalizeAutoChartUnits(
      [
        {
          data: [{ label: 'A', value: 8500 }],
          xField: 'label',
          yFields: ['value'],
          unit: '万元',
        },
      ],
      [{ mea_unit: '万元', index_value: 8500 }]
    )[0] as Record<string, unknown>;

    expect(chart.unit).toBe('万元');
    expect((chart.data as Array<Record<string, number>>)[0].value).toBe(8500);
  });

  it('converts 5,448,220 万元 to 544.82 亿元 exactly once', () => {
    const chart = normalizeAutoChartUnits(
      [
        {
          data: [{ brchna: '机构A', index_value: 5448220 }],
          xField: 'brchna',
          yFields: ['index_value'],
          unit: '万元',
        },
      ],
      [{ mea_unit: '万元', index_value: 5448220 }]
    )[0] as Record<string, unknown>;

    expect(chart.unit).toBe('亿元');
    expect((chart.data as Array<Record<string, number>>)[0].index_value).toBe(
      544.82
    );
  });

  it('converts the default multi-organization pie values to two decimal 亿元', () => {
    const chart = normalizeAutoChartUnits(
      [
        {
          type: 'pie',
          data: [
            { brchna: '金坛支行', index_value: 4558628.599004 },
            { brchna: '溧阳支行', index_value: 7852121.095636 },
          ],
          xField: 'brchna',
          yFields: ['index_value'],
          unit: '万元',
        },
      ],
      [
        { brchna: '金坛支行', index_value: 4558628.599004, mea_unit: '万元' },
        { brchna: '溧阳支行', index_value: 7852121.095636, mea_unit: '万元' },
      ]
    )[0] as Record<string, unknown>;

    expect(chart.unit).toBe('亿元');
    expect(
      (chart.data as Array<Record<string, number>>).map(
        (row) => row.index_value
      )
    ).toEqual([455.86, 785.21]);
  });

  it('does not mutate source rows', () => {
    const rows = [{ mea_unit: '万元', index_value: 20000 }];
    normalizeAutoChartUnits(
      [
        {
          data: [{ value: 20000 }],
          xField: 'x',
          yFields: ['value'],
          unit: '万元',
        },
      ],
      rows
    );
    expect(rows[0].index_value).toBe(20000);
  });

  it('converts legacy echartsOption series and axis unit', () => {
    const chart = normalizeAutoChartUnits(
      [
        {
          echartsOption: {
            yAxis: { type: 'value', name: '万元' },
            series: [
              {
                type: 'line',
                data: [49860525, { name: '上月末', value: 49041141 }],
              },
            ],
          },
        },
      ],
      [{ mea_unit: '万元' }]
    )[0] as Record<string, unknown>;
    const option = chart.echartsOption as Record<string, unknown>;
    expect((option.yAxis as Record<string, unknown>).name).toBe('亿元');
    const data = (option.series as Array<Record<string, unknown>>)[0]
      .data as unknown[];
    expect(data[0]).toBe(4986.05);
    expect((data[1] as Record<string, unknown>).value).toBe(4904.11);
  });
});
