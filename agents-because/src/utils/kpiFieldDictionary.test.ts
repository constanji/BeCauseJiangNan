import {
  BASELINE_GROUPS,
  INDEX_VALUE_FIELD,
  pickAvailableBaselineGroups,
  selectComparisonBasis,
  resolveChangeValue,
  resolveChangeRatio,
  hasIndexValue,
  isBlacklistedNumericField,
  kpiFieldDictionary,
} from './kpiFieldDictionary';

describe('kpiFieldDictionary', () => {
  const fullRow = {
    index_value: 100,
    ly_value: 70,
    ly_change_value: 30,
    ly_change_ratio: 42.86,
    y_begin_value: 75,
    y_begin_change_value: 25,
    y_begin_change_ratio: 33.33,
    q_begin_value: 80,
    q_begin_change_value: 20,
    q_begin_change_ratio: 25,
    m_begin_value: 90,
    m_begin_change_value: 10,
    m_begin_change_ratio: 11.11,
    yd_value: 95,
    yd_change_value: 5,
    yd_change_ratio: 5.26,
    curr_code: 'CNY',
    mea_unit: '万元',
  };

  it('exposes five baseline groups in display order', () => {
    expect(BASELINE_GROUPS.map((g) => g.id)).toEqual([
      'ly',
      'y_begin',
      'q_begin',
      'm_begin',
      'yd',
    ]);
    expect(BASELINE_GROUPS.map((g) => g.label)).toEqual([
      '上年同期',
      '上年末',
      '上季末',
      '上月末',
      '上一日',
    ]);
  });

  it('pickAvailableBaselineGroups returns non-empty groups in display order', () => {
    const groups = pickAvailableBaselineGroups(fullRow);
    expect(groups.map((g) => g.id)).toEqual([
      'ly',
      'y_begin',
      'q_begin',
      'm_begin',
      'yd',
    ]);
  });

  it('pickAvailableBaselineGroups skips empty baselines', () => {
    const groups = pickAvailableBaselineGroups({
      index_value: 100,
      m_begin_value: 90,
      ly_value: '',
      yd_value: null,
    });
    expect(groups.map((g) => g.id)).toEqual(['m_begin']);
  });

  it('selectComparisonBasis prefers keyword hits', () => {
    expect(selectComparisonBasis('看同比变化', fullRow)?.id).toBe('ly');
    expect(selectComparisonBasis('较月初增长多少', fullRow)?.id).toBe('m_begin');
    expect(selectComparisonBasis('比上日', fullRow)?.id).toBe('yd');
    expect(selectComparisonBasis('较年初', fullRow)?.id).toBe('y_begin');
    expect(selectComparisonBasis('季比如何', fullRow)?.id).toBe('q_begin');
  });

  it('selectComparisonBasis defaults to m_begin when multiple groups exist', () => {
    expect(selectComparisonBasis('这个指标怎么样', fullRow)?.id).toBe('m_begin');
  });

  it('selectComparisonBasis returns the only available group', () => {
    expect(
      selectComparisonBasis('随便', { index_value: 1, yd_value: 2 })?.id,
    ).toBe('yd');
  });

  it('resolveChangeValue prefers *_change_value then falls back to index - baseline', () => {
    const mBegin = BASELINE_GROUPS.find((g) => g.id === 'm_begin')!;
    expect(resolveChangeValue(fullRow, mBegin)).toBe(10);
    expect(
      resolveChangeValue(
        { index_value: 100, m_begin_value: 90 },
        mBegin,
      ),
    ).toBe(10);
  });

  it('resolveChangeRatio does not rescale percentages', () => {
    const mBegin = BASELINE_GROUPS.find((g) => g.id === 'm_begin')!;
    // 11.11 is already a percent figure — must not become 1111
    expect(resolveChangeRatio(fullRow, mBegin)).toBe(11.11);
  });

  it('blacklists curr_code and mea_unit', () => {
    expect(isBlacklistedNumericField('curr_code')).toBe(true);
    expect(isBlacklistedNumericField('mea_unit')).toBe(true);
    expect(isBlacklistedNumericField(INDEX_VALUE_FIELD)).toBe(false);
  });

  it('hasIndexValue is strict', () => {
    expect(hasIndexValue(fullRow)).toBe(true);
    expect(hasIndexValue({ value: 100 })).toBe(false);
  });

  it('namespace export is complete for CJS smoke tests', () => {
    expect(kpiFieldDictionary.INDEX_VALUE_FIELD).toBe('index_value');
    expect(typeof kpiFieldDictionary.selectComparisonBasis).toBe('function');
    expect(typeof kpiFieldDictionary.pickAvailableBaselineGroups).toBe(
      'function',
    );
  });
});
