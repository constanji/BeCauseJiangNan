const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatTableNotFoundMessage,
  shortenDbError,
} = require('../src/services/DatabaseService');

describe('DatabaseService error helpers', () => {
  it('formatTableNotFoundMessage 返回中文友好文案', () => {
    const msg = formatTableNotFoundMessage('kpi', 'dim_conf');
    assert.match(msg, /远程库中不存在表 kpi\.dim_conf/);
    assert.match(msg, /LightSchema 可能已过期/);
  });

  it('shortenDbError 将 relation does not exist 转为友好文案', () => {
    const raw = 'ERROR: relation "kpi.kpi_dim_conf_base_0626" does not exist\n  Position: 15';
    const msg = shortenDbError(raw);
    assert.match(msg, /远程库中不存在表 kpi\.kpi_dim_conf_base_0626/);
    assert.doesNotMatch(msg, /Position:/);
  });

  it('shortenDbError 截断长错误首行', () => {
    const long = 'x'.repeat(300);
    assert.equal(shortenDbError(long).length, 240);
  });

  it('shortenDbError 空消息有默认文案', () => {
    assert.equal(shortenDbError(''), '数据库查询失败');
  });
});
