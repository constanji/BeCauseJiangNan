const { chartMatchPreview } = require('./chartMatchPreview');

function invoke(body) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return chartMatchPreview({ body }, res).then(() => res);
}

describe('chartMatchPreview', () => {
  const rows = [
    { org_code: 'A0008', brchna: '金坛支行', index_value: 4558628.599004, mea_unit: '万元' },
    { org_code: 'A0009', brchna: '溧阳支行', index_value: 7852121.095636, mea_unit: '万元' },
  ];

  it('uses the default dimension rule and reports pie', async () => {
    const res = await invoke({ chartConfig: {}, query: '存款余额', toolOutput: rows });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'matched',
      rule: 'dimension_compare',
      chartType: 'pie',
      dimensionField: 'brchna',
      measureFields: ['index_value'],
    }));
    expect(res.json.mock.calls[0][0].effectiveRule.dimension_compare.chart_type).toBe('pie');
  });

  it('applies an override and a disabled rule', async () => {
    const bar = await invoke({
      chartConfig: { match_rules: { dimension_compare: { chart_type: 'bar' } } },
      toolOutput: rows,
    });
    expect(bar.json.mock.calls[0][0]).toEqual(expect.objectContaining({ chartType: 'bar' }));

    const disabled = await invoke({
      chartConfig: { match_rules: { dimension_compare: { enabled: false } } },
      toolOutput: rows,
    });
    expect(disabled.json.mock.calls[0][0]).toEqual(expect.objectContaining({
      status: 'disabled',
      rule: 'dimension_compare',
    }));
  });

  it('returns parse_failed for unsupported output', async () => {
    const res = await invoke({ chartConfig: {}, toolOutput: 'no tabular result' });
    expect(res.json).toHaveBeenCalledWith({ status: 'parse_failed' });
  });
});
