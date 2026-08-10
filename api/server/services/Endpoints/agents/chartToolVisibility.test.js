const { getModelHiddenTools } = require('./chartToolVisibility');

describe('getModelHiddenTools', () => {
  const mountedTools = ['because_jn', 'echarts_generator_app'];

  it('hides ECharts when the explicit setting is enabled', () => {
    expect(
      getModelHiddenTools({
        tools: mountedTools,
        chart_config: { hide_from_model: true },
      }),
    ).toEqual(['echarts_generator_app']);
  });

  it.each([
    { auto_chart: false, preset: 'indicator', hide_from_model: false },
    { auto_chart: true, preset: 'indicator', hide_from_model: undefined },
    { auto_chart: true, preset: 'attribution', hide_from_model: false },
  ])('keeps the tool visible unless explicitly hidden', ({ auto_chart, preset, hide_from_model }) => {
    expect(
      getModelHiddenTools({
        tools: mountedTools,
        auto_chart,
        chart_config: { preset, hide_from_model },
      }),
    ).toEqual([]);
  });

  it('does not hide a tool that is not mounted', () => {
    expect(
      getModelHiddenTools({
        tools: ['because_jn'],
        chart_config: { hide_from_model: true },
      }),
    ).toEqual([]);
  });

  it('supports initialized tool instances as well as stored tool names', () => {
    expect(
      getModelHiddenTools({
        tools: [{ name: 'echarts_generator_app' }],
        chart_config: { hide_from_model: true },
      }),
    ).toEqual(['echarts_generator_app']);
  });

  it('checks resolved tools when persisted agent tools are ids', () => {
    expect(
      getModelHiddenTools(
        {
          tools: ['67f0b9e8c7f8a90123456789'],
          chart_config: { hide_from_model: true },
        },
        [{ name: 'because_skills_2' }, { name: 'echarts_generator_app' }],
      ),
    ).toEqual(['echarts_generator_app']);
  });
});
