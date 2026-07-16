const { formatConnectionTestError, buildConnectionTestApiPayload } = require('./formatConnectionTestError');

describe('formatConnectionTestError', () => {
  const config = { type: 'mysql', host: '10.0.0.1', port: 3306, database: 'kpi', username: 'root' };

  it('maps ECONNREFUSED to readable message', () => {
    const result = formatConnectionTestError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, config);
    expect(result.code).toBe('ECONNREFUSED');
    expect(result.error).toContain('10.0.0.1:3306');
    expect(result.hint).toBeTruthy();
  });

  it('maps MySQL access denied', () => {
    const result = formatConnectionTestError(
      { code: 'ER_ACCESS_DENIED_ERROR', errno: 1045, message: "Access denied for user 'root'@'10.0.0.2'" },
      config,
    );
    expect(result.code).toBe('AUTH_FAILED');
    expect(result.error).toContain('root');
  });

  it('maps PostgreSQL invalid password', () => {
    const result = formatConnectionTestError(
      { code: '28P01', message: 'password authentication failed for user "app"' },
      { ...config, type: 'postgresql', username: 'app' },
    );
    expect(result.code).toBe('AUTH_FAILED');
  });

  it('maps unknown database', () => {
    const result = formatConnectionTestError(
      { code: 'ER_BAD_DB_ERROR', errno: 1049, message: "Unknown database 'missing_db'" },
      { ...config, database: 'missing_db' },
    );
    expect(result.code).toBe('DATABASE_NOT_FOUND');
    expect(result.error).toContain('missing_db');
  });

  it('falls back with raw message', () => {
    const result = formatConnectionTestError(new Error('custom driver failure'), config);
    expect(result.error).toContain('custom driver failure');
    expect(result.code).toBe('CONNECTION_FAILED');
  });
});

describe('buildConnectionTestApiPayload', () => {
  it('includes both error and message on failure', () => {
    const payload = buildConnectionTestApiPayload({
      success: false,
      error: '无法连接',
      code: 'ECONNREFUSED',
      hint: '检查端口',
    });
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('无法连接');
    expect(payload.message).toBe('无法连接');
    expect(payload.code).toBe('ECONNREFUSED');
    expect(payload.hint).toBe('检查端口');
  });
});
