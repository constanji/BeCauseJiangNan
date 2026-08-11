import { buildIndicatorCharts } from './indicator';
import { buildAttributionCharts } from './attribution';

describe('buildIndicatorCharts', () => {
  it('builds a sparkline for single-row multi-baseline with index_value', () => {
    const charts = buildIndicatorCharts([
      {
        index_name: '贷款余额',
        index_value: 100,
        ly_value: 70,
        m_begin_value: 90,
        yd_value: 95,
      },
    ]);
    expect(charts).toHaveLength(1);
    expect(charts[0].role).toBe('indicator');
    expect(charts[0].type).toBe('line');
    expect(charts[0].data.length).toBeGreaterThanOrEqual(3);
  });

  it('builds org bar for multi-row index_value by default', () => {
    const charts = buildIndicatorCharts([
      { org_name: 'A', index_value: 10 },
      { org_name: 'B', index_value: 20 },
    ]);
    expect(charts[0]?.type).toBe('bar');
    expect(charts[0]?.xField).toBe('org_name');
  });

  it('builds org bar from institution dimensions regardless of question wording', () => {
    const charts = buildIndicatorCharts(
      [
        { org_name: '总行', standard_name: '存款余额', index_value: 125050 },
        { org_name: '武进分行', standard_name: '存款余额', index_value: 82030 },
        { org_name: '金坛分行', standard_name: '存款余额', index_value: 69320 },
      ],
      { userQuestion: '各机构存款余额占比情况' },
    );

    expect(charts).toHaveLength(1);
    expect(charts[0]).toMatchObject({
      type: 'bar',
      role: 'indicator',
      xField: 'org_name',
      yFields: ['index_value'],
      title: '存款余额对比图',
    });
  });

  it('recognizes DAT brchna as the preferred institution label', () => {
    const charts = buildIndicatorCharts(
      [
        {
          org_code: 'FR001',
          brchna: '总行',
          standard_name: '存款余额',
          index_value: 125050,
        },
        {
          org_code: 'A0001',
          brchna: '武进分行',
          standard_name: '存款余额',
          index_value: 82030,
        },
      ],
      { userQuestion: '各机构存款余额占比' },
    );
    expect(charts[0]).toMatchObject({
      type: 'bar',
      xField: 'brchna',
      title: '存款余额对比图',
    });
  });

  it('keeps multi-period data as a line trend regardless of question wording', () => {
    const charts = buildIndicatorCharts(
      [
        { data_dt: '2026-05-30', org_name: '总行', index_value: 100 },
        { data_dt: '2026-05-31', org_name: '总行', index_value: 120 },
      ],
      { userQuestion: '总行存款占比趋势' },
    );
    expect(charts[0]?.type).toBe('line');
  });

  it('skips when index_value missing', () => {
    expect(
      buildIndicatorCharts([{ org_name: 'A', value: 10 }]),
    ).toEqual([]);
  });
});

describe('buildAttributionCharts', () => {
  it('builds indicator + contribution + drag from multi-org rows', () => {
    const charts = buildAttributionCharts({
      rows: [
        {
          org_name: 'A',
          index_value: 120,
          m_begin_value: 100,
          m_begin_change_value: 20,
        },
        {
          org_name: 'B',
          index_value: 80,
          m_begin_value: 100,
          m_begin_change_value: -20,
        },
        {
          org_name: 'C',
          index_value: 110,
          m_begin_value: 100,
          m_begin_change_value: 10,
        },
      ],
      userQuestion: '较月初波动归因',
    });
    const roles = charts.map((c) => c.role);
    expect(roles).toContain('indicator');
    expect(roles).toContain('contribution');
    expect(roles).toContain('drag');
  });

  it('prefers current_data from attribution args', () => {
    const charts = buildAttributionCharts({
      rows: [{ org_name: 'X', index_value: 1, m_begin_value: 1 }],
      current_data: [
        {
          org_name: 'Y',
          index_value: 150,
          m_begin_value: 100,
          m_begin_change_value: 50,
        },
      ],
      userQuestion: '月初',
    });
    expect(charts.some((c) => c.title.includes('总体') || c.role === 'indicator')).toBe(
      true,
    );
  });
});
