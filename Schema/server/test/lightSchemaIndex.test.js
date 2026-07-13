const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildColumnSearchText,
  columnMatchesQuery,
  columnMatchesSampleQuery,
  matchedSampleValues,
  normalizeSearchLike,
  getColumnCount,
} = require('../src/lib/lightSchemaIndex');

const sampleContent = {
  tableDescription: '贷款明细表',
  columns: [
    { name: 'id', description: '主键' },
    { name: 'loan_type', description: '贷款类型', sampleValues: ['住房贷款', '消费贷'] },
    { name: 'owner', description: '持有人', sampleValues: ['  ', null] },
  ],
};

describe('lightSchemaIndex', () => {
  it('buildColumnSearchText 包含表备注、列名、注释与采样值', () => {
    const text = buildColumnSearchText(sampleContent);
    assert.match(text, /贷款明细表/);
    assert.match(text, /loan_type/);
    assert.match(text, /贷款类型/);
    assert.match(text, /住房贷款/);
    assert.match(text, /消费贷/);
    assert.doesNotMatch(text, /持有人.*住房贷款/); // 空采样值不入索引
  });

  it('columnMatchesQuery 可命中采样值文本', () => {
    const col = sampleContent.columns[1];
    assert.equal(columnMatchesQuery(col, '住房'), true);
    assert.equal(columnMatchesQuery(col, '不存在'), false);
  });

  it('columnMatchesSampleQuery 与 matchedSampleValues 返回采样命中', () => {
    const col = sampleContent.columns[1];
    assert.equal(columnMatchesSampleQuery(col, '消费'), true);
    assert.deepEqual(matchedSampleValues(col, '住房'), ['住房贷款']);
  });

  it('normalizeSearchLike 生成小写 LIKE 模式', () => {
    assert.equal(normalizeSearchLike('Loan'), '%loan%');
    assert.equal(normalizeSearchLike('  '), '%%');
  });

  it('getColumnCount 统计列数', () => {
    assert.equal(getColumnCount(sampleContent), 3);
    assert.equal(getColumnCount('not-json'), 0);
  });
});
