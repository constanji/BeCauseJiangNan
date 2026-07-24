const {
  parseRowKey,
  parseDisplayName,
  normalizeAliases,
  upsertAliasInFullRow,
  isAliasCapableFilename,
} = require('../ExcelCellAliasService');

describe('ExcelCellAliasService helpers', () => {
  it('parseRowKey 从指标/机构 full_row 提取主键', () => {
    expect(
      parseRowKey('指标编号: BM10010048 | 标准名称: 各项存款余额(人行口径)'),
    ).toBe('BM10010048');
    expect(parseRowKey("org_code: A0001 | org_name: 武进支行")).toBe('A0001');
    expect(parseRowKey('无关文本')).toBe('');
  });

  it('parseDisplayName', () => {
    expect(parseDisplayName('指标编号: X | 标准名称: 存款余额 | 单位: 万')).toBe('存款余额');
    expect(parseDisplayName('org_code: A | org_name: 常州分行')).toBe('常州分行');
  });

  it('normalizeAliases 去重 trim', () => {
    expect(normalizeAliases([' 存款余额 ', '存款余额', '', '余额'])).toEqual(['存款余额', '余额']);
  });

  it('upsertAliasInFullRow 写入/替换别名段', () => {
    const base = '指标编号: BM1 | 标准名称: 存款';
    expect(upsertAliasInFullRow(base, ['存款余额'])).toBe(
      '指标编号: BM1 | 标准名称: 存款 | 别名: 存款余额',
    );
    expect(upsertAliasInFullRow(`${base} | 别名: 旧名`, ['新名', '新名2'])).toBe(
      '指标编号: BM1 | 标准名称: 存款 | 别名: 新名；新名2',
    );
    expect(upsertAliasInFullRow(`${base} | 别名: 旧`, [])).toBe(base);
  });

  it('isAliasCapableFilename', () => {
    expect(isAliasCapableFilename('指标定义信息')).toBe(true);
    expect(isAliasCapableFilename('机构信息')).toBe(true);
    expect(isAliasCapableFilename('其他.xlsx')).toBe(false);
  });

  it('别名包含查询：辅助逻辑与 normalize 一致', () => {
    const aliases = normalizeAliases(['存款余额', '各项存款']);
    const q = '存款余额';
    expect(aliases.some((a) => a.toLowerCase().includes(q))).toBe(true);
    expect(aliases.some((a) => a.toLowerCase().includes('不存在'))).toBe(false);
  });
});
