/**
 * Smoke test: API runtime can require shared chart utilities from @because/agents.
 * Run after `cd agents-because && npm run build:runtime` so dist/cjs is fresh.
 */
describe('@because/agents chart exports (CJS smoke)', () => {
  it('exports kpiFieldDictionary and auto-chart helpers', () => {
    let agents;
    try {
      agents = require('@because/agents');
    } catch (err) {
      throw new Error(
        `Cannot require('@because/agents'): ${err.message}. Run agents-because build:runtime first.`,
      );
    }

    expect(agents.kpiFieldDictionary).toBeDefined();
    expect(typeof agents.kpiFieldDictionary.selectComparisonBasis).toBe('function');
    expect(agents.INDEX_VALUE_FIELD).toBe('index_value');
    expect(typeof agents.detectChartability).toBe('function');
    expect(typeof agents.buildAutoCharts).toBe('function');
  });
});
