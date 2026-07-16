const {
  CATEGORY,
  buildSqlExecutorError,
  formatSqlExecutorError,
} = require('./formatSqlExecutorError');

describe('buildSqlExecutorError', () => {
  it('keeps backward-compatible error/sql fields', () => {
    const payload = buildSqlExecutorError({
      error: 'only select',
      code: 'NOT_READONLY',
      category: CATEGORY.SQL_POLICY,
      hint: 'use SELECT',
      sql: 'DELETE FROM t',
    });
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('only select');
    expect(payload.sql).toBe('DELETE FROM t');
    expect(payload.code).toBe('NOT_READONLY');
    expect(payload.category).toBe('SQL_POLICY');
    expect(payload.hint).toBe('use SELECT');
  });
});

describe('formatSqlExecutorError', () => {
  const sql = 'SELECT * FROM missing_table';

  it('maps missing datasource config messages', () => {
    const result = formatSqlExecutorError(new Error('数据源不存在: abc'), { sql });
    expect(result.code).toBe('DATASOURCE_NOT_FOUND');
    expect(result.category).toBe(CATEGORY.DATASOURCE_CONFIG);
    expect(result.sql).toBe(sql);
  });

  it('maps table not found (MySQL)', () => {
    const result = formatSqlExecutorError(
      { code: 'ER_NO_SUCH_TABLE', errno: 1146, message: "Table 'kpi.foo' doesn't exist" },
      { sql },
    );
    expect(result.code).toBe('TABLE_NOT_FOUND');
    expect(result.category).toBe(CATEGORY.SQL_SEMANTIC);
    expect(result.error).toMatch(/不存在/);
  });

  it('maps column not found (PostgreSQL)', () => {
    const result = formatSqlExecutorError(
      { code: '42703', message: 'column "org_cd" does not exist' },
      { sql },
    );
    expect(result.code).toBe('COLUMN_NOT_FOUND');
    expect(result.category).toBe(CATEGORY.SQL_SEMANTIC);
  });

  it('maps syntax error', () => {
    const result = formatSqlExecutorError(
      { code: 'ER_PARSE_ERROR', errno: 1064, message: "You have an error in your SQL syntax; check near 'FORM'" },
      { sql: 'SELECT * FORM t' },
    );
    expect(result.code).toBe('SQL_SYNTAX');
    expect(result.category).toBe(CATEGORY.SQL_SYNTAX);
  });

  it('wraps connection refused with SQL-scenario wording', () => {
    const result = formatSqlExecutorError(
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:3306' },
      {
        sql,
        dataSource: { host: '10.0.0.1', port: 3306, type: 'mysql', name: 'kpi', database: 'kpi' },
      },
    );
    expect(result.category).toBe(CATEGORY.CONNECTION);
    expect(result.error).toMatch(/^SQL执行前连接数据源失败：/);
    expect(result.error).not.toMatch(/连接测试/);
    expect(result.hint).toBeTruthy();
  });

  it('maps query timeout', () => {
    const result = formatSqlExecutorError(
      { code: '57014', message: 'canceling statement due to statement timeout' },
      { sql },
    );
    expect(result.code).toBe('QUERY_TIMEOUT');
    expect(result.category).toBe(CATEGORY.TIMEOUT);
  });

  it('maps auth failure via connection classifier wrap', () => {
    const result = formatSqlExecutorError(
      { code: 'ER_ACCESS_DENIED_ERROR', errno: 1045, message: "Access denied for user 'root'@'%'" },
      {
        sql,
        dataSource: { type: 'mysql', username: 'root', host: 'db', port: 3306, database: 'kpi' },
      },
    );
    expect(result.category).toBe(CATEGORY.AUTH);
    expect(result.error).toMatch(/^SQL执行前连接数据源失败：/);
  });

  it('maps unknown database to DATASOURCE_CONFIG', () => {
    const result = formatSqlExecutorError(
      { code: 'ER_BAD_DB_ERROR', errno: 1049, message: "Unknown database 'missing_db'" },
      {
        sql,
        dataSource: { type: 'mysql', host: 'db', port: 3306, database: 'missing_db', username: 'root' },
      },
    );
    expect(result.code).toBe('DATABASE_NOT_FOUND');
    expect(result.category).toBe(CATEGORY.DATASOURCE_CONFIG);
    expect(result.error).toMatch(/^SQL执行前连接数据源失败：/);
  });
});
