import { ChartRunRegistry } from './ChartRunRegistry';

describe('ChartRunRegistry', () => {
  it('isolates by agentId and stepId', () => {
    const reg = new ChartRunRegistry();
    reg.register('a1', 's1', {
      chartId: 'c1',
      role: 'indicator',
      source: 'server_auto',
    });
    expect(reg.hasRole('a1', 's1', 'indicator')).toBe(true);
    expect(reg.hasRole('a2', 's1', 'indicator')).toBe(false);
    expect(reg.hasRole('a1', 's2', 'indicator')).toBe(false);
    expect(reg.countThisTurn('a1', 's1')).toBe(1);
    expect(reg.countThisTurn('a2', 's1')).toBe(0);
  });

  it('reassigns duplicate chart ids instead of overwriting', () => {
    const reg = new ChartRunRegistry();
    const id1 = reg.register('a', 's', {
      chartId: 'chart_1',
      role: 'indicator',
      source: 'model_simple',
    });
    const id2 = reg.register('a', 's', {
      chartId: 'chart_1',
      role: 'general',
      source: 'model_simple',
    });
    expect(id1).toBe('chart_1');
    expect(id2).toBe('chart_1_2');
    expect(reg.countThisTurn('a', 's')).toBe(2);
  });

  it('reports missing roles', () => {
    const reg = new ChartRunRegistry();
    reg.register('a', 's', {
      chartId: 'i',
      role: 'indicator',
      source: 'server_auto',
    });
    expect(
      reg.getMissingRoles('a', 's', ['indicator', 'contribution', 'drag']),
    ).toEqual(['contribution', 'drag']);
  });

  it('reports server_auto ownership for duplicate suppression', () => {
    const reg = new ChartRunRegistry();
    reg.register('a', 'current', {
      chartId: 'c1',
      role: 'indicator',
      source: 'server_auto',
    });
    expect(reg.hasSource('a', 'current', 'server_auto')).toBe(true);
    expect(reg.hasSource('a', 'current', 'model_simple')).toBe(false);
  });

  it('clear empties all scopes', () => {
    const reg = new ChartRunRegistry();
    reg.register('a', 's', {
      chartId: 'c',
      role: 'general',
      source: 'model_legacy',
    });
    reg.clear();
    expect(reg.countThisTurn('a', 's')).toBe(0);
  });

  it('tracks automatic data calls independently from chart entries', () => {
    const reg = new ChartRunRegistry();
    expect(reg.hasAutoGenerationKey('a', 's', 'call-1')).toBe(false);
    reg.markAutoGenerationKey('a', 's', 'call-1');
    expect(reg.hasAutoGenerationKey('a', 's', 'call-1')).toBe(true);
    expect(reg.hasAutoGenerationKey('b', 's', 'call-1')).toBe(false);
    reg.clear();
    expect(reg.hasAutoGenerationKey('a', 's', 'call-1')).toBe(false);
  });
});
