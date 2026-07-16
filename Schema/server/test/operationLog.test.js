const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  diffColumnNames,
  formatColumnChangeDetail,
  columnNamesFromContent,
} = require('../src/lib/operationLog');

describe('operationLog', () => {
  it('diffColumnNames 识别删除与新增列', () => {
    const diff = diffColumnNames(['id', 'name', 'age'], ['id', 'name', 'phone']);
    assert.deepEqual(diff.removed, ['age']);
    assert.deepEqual(diff.added, ['phone']);
    assert.equal(diff.beforeCount, 3);
    assert.equal(diff.afterCount, 3);
  });

  it('formatColumnChangeDetail 输出可读摘要', () => {
    const text = formatColumnChangeDetail({
      beforeCount: 5,
      afterCount: 4,
      removed: ['owner'],
      added: [],
    });
    assert.match(text, /5列 → 4列/);
    assert.match(text, /删除列: owner/);
  });

  it('columnNamesFromContent 解析列名', () => {
    const names = columnNamesFromContent(JSON.stringify({
      columns: [{ name: 'a' }, { name: 'b' }],
    }));
    assert.deepEqual(names, ['a', 'b']);
  });
});
