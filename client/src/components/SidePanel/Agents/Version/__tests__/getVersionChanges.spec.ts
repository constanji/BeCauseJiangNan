import { getVersionChanges } from '../getVersionChanges';

describe('getVersionChanges chart settings', () => {
  it('reports auto_chart and chart_config differences', () => {
    const previous = {
      name: 'A',
      auto_chart: false,
      chart_config: {
        marker: 'zb',
        max_charts: 1,
        dedupe_roles: true,
        hide_legend: false,
        hide_from_model: false,
      },
    };
    const current = {
      name: 'A',
      auto_chart: true,
      chart_config: {
        marker: 'zb',
        max_charts: 1,
        dedupe_roles: false,
        hide_legend: true,
        hide_from_model: true,
      },
    };

    const summary = getVersionChanges(previous, current);
    expect(summary.kind).toBe('changes');
    expect(summary.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['auto_chart', 'chart_config']),
    );
    const chartChange = summary.changes.find((c) => c.field === 'chart_config');
    expect(chartChange?.before).toContain('去掉图例=关');
    expect(chartChange?.after).toContain('去掉图例=开');
    expect(chartChange?.before).toContain('同角色去重=开');
    expect(chartChange?.after).toContain('同角色去重=关');
    expect(chartChange?.before).toContain('对模型隐藏=关');
    expect(chartChange?.after).toContain('对模型隐藏=开');
  });

  it('returns none when only chart_config is identical', () => {
    const previous = {
      name: 'A',
      chart_config: { marker: 'zb', hide_legend: true },
    };
    const current = {
      name: 'A',
      chart_config: { marker: 'zb', hide_legend: true },
    };
    expect(getVersionChanges(previous, current).kind).toBe('none');
  });
});
