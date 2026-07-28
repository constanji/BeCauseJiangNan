/**
 * SQL Executor 统一失败响应构造与错误分类。
 * - 覆盖「工具主动拒绝」与「数据库执行异常」两类失败
 * - 成功截断（ROW_LIMIT）不走本模块，仍由 success:true + truncated/truncation_hint 表达
 * - 连接类错误复用 formatConnectionTestError 的分类规则，但改写为 SQL 执行场景文案
 */

const path = require('path');

let formatConnectionTestError;
try {
  ({ formatConnectionTestError } = require('./formatConnectionTestError'));
} catch {
  try {
    ({ formatConnectionTestError } = require(path.join(__dirname, 'formatConnectionTestError')));
  } catch {
    formatConnectionTestError = null;
  }
}

const CATEGORY = {
  SQL_POLICY: 'SQL_POLICY',
  DATASOURCE_CONFIG: 'DATASOURCE_CONFIG',
  CONNECTION: 'CONNECTION',
  AUTH: 'AUTH',
  SQL_SYNTAX: 'SQL_SYNTAX',
  SQL_SEMANTIC: 'SQL_SEMANTIC',
  TIMEOUT: 'TIMEOUT',
  PERMISSION: 'PERMISSION',
  UNKNOWN: 'UNKNOWN',
};

/**
 * 统一构造 success:false 响应（保持 error/sql 向后兼容）
 * @param {object} opts
 * @param {string} opts.error
 * @param {string} [opts.code]
 * @param {string} [opts.category]
 * @param {string} [opts.hint]
 * @param {string} [opts.sql]
 * @param {object} [opts.dataSource]
 * @param {string} [opts.raw]
 * @returns {object}
 */
function buildSqlExecutorError({
  error,
  code = 'SQL_EXECUTION_FAILED',
  category = CATEGORY.UNKNOWN,
  hint,
  sql,
  dataSource,
  raw,
} = {}) {
  const payload = {
    success: false,
    error: String(error || 'SQL执行失败'),
    code: String(code || 'SQL_EXECUTION_FAILED'),
    category: String(category || CATEGORY.UNKNOWN),
  };

  if (hint) payload.hint = String(hint);
  if (sql) payload.sql = String(sql);
  if (raw) payload.raw = truncateMessage(String(raw), 300);
  if (dataSource && typeof dataSource === 'object') {
    payload.dataSource = {
      ...(dataSource.id != null ? { id: String(dataSource.id) } : {}),
      ...(dataSource.name != null ? { name: String(dataSource.name) } : {}),
      ...(dataSource.type != null ? { type: String(dataSource.type) } : {}),
      ...(dataSource.database != null ? { database: String(dataSource.database) } : {}),
    };
  }

  return payload;
}

function stringifySqlExecutorError(opts) {
  return JSON.stringify(buildSqlExecutorError(opts), null, 2);
}

/**
 * 将原始异常分类为结构化 SQL 执行错误
 * @param {unknown} error
 * @param {{ sql?: string, dataSource?: object }} [context]
 * @returns {object} buildSqlExecutorError 结果
 */
function formatSqlExecutorError(error, context = {}) {
  const raw = extractRawMessage(error);
  const lower = raw.toLowerCase();
  const code = error && typeof error === 'object' ? error.code : undefined;
  const errno = error && typeof error === 'object' ? error.errno : undefined;
  const sqlState = error && typeof error === 'object' ? error.sqlState : undefined;
  const sql = context.sql;
  const dataSource = summarizeDataSource(context.dataSource);

  // ---- 数据源配置（throw 路径常见文案）----
  if (/无效的数据源id|数据源不存在/.test(lower)) {
    return buildSqlExecutorError({
      error: raw || '数据源不存在或 ID 无效',
      code: 'DATASOURCE_NOT_FOUND',
      category: CATEGORY.DATASOURCE_CONFIG,
      hint: '请检查 Agent 绑定的数据源，或在调用时传入正确的 data_source_id',
      sql,
      dataSource,
      raw,
    });
  }

  // 模型传了 query 却未传 sql，旧代码对 undefined.trim() 会抛出英文 TypeError
  if (
    /cannot read propert(y|ies) of undefined.*(reading ['"]trim['"])/i.test(raw) ||
    /reading ['"]trim['"]/i.test(raw)
  ) {
    return buildSqlExecutorError({
      error:
        '缺少 SQL 语句：请在 arguments 中传入 sql（推荐），也兼容 query / statement。示例：{"sql":"SELECT * FROM dim_region"}。',
      code: 'MISSING_SQL',
      category: CATEGORY.SQL_POLICY,
      hint: '参数名须为 sql 或 query，值为完整只读 SELECT/WITH 语句',
      sql,
      dataSource,
      raw,
    });
  }

  if (/数据源未激活/.test(lower)) {
    return buildSqlExecutorError({
      error: raw,
      code: 'DATASOURCE_INACTIVE',
      category: CATEGORY.DATASOURCE_CONFIG,
      hint: '请在全局配置中将该数据源状态设为启用（active）后再执行 SQL',
      sql,
      dataSource,
      raw,
    });
  }

  if (/不支持的数据库类型/.test(lower)) {
    return buildSqlExecutorError({
      error: raw,
      code: 'UNSUPPORTED_DB_TYPE',
      category: CATEGORY.DATASOURCE_CONFIG,
      hint: '当前工具支持的数据库类型以工具描述为准；请更换数据源或联系管理员',
      sql,
      dataSource,
      raw,
    });
  }

  if (/密码解密失败|无法解密旧格式的密码/.test(lower)) {
    return buildSqlExecutorError({
      error: raw,
      code: 'PASSWORD_DECRYPT_FAILED',
      category: CATEGORY.DATASOURCE_CONFIG,
      hint: '请编辑该数据源，重新输入密码并保存配置',
      sql,
      dataSource,
      raw,
    });
  }

  // ---- SQL 语义 / 语法（先于通用连接判断，避免把 "does not exist" 误判为库不存在）----
  if (
    code === 'ER_NO_SUCH_TABLE' ||
    errno === 1146 ||
    code === '42P01' ||
    /table .* doesn'?t exist|relation .* does not exist|unknown table|表.*不存在/.test(lower)
  ) {
    const tableName = extractQuotedName(raw) || extractAfterKeyword(raw, /table|relation|表/i);
    return buildSqlExecutorError({
      error: tableName ? `表「${tableName}」不存在` : `表不存在：${truncateMessage(raw, 120)}`,
      code: 'TABLE_NOT_FOUND',
      category: CATEGORY.SQL_SEMANTIC,
      hint: '请用 light-schema 确认表名与 schema，注意大小写与 schema 前缀',
      sql,
      dataSource,
      raw,
    });
  }

  if (
    code === 'ER_BAD_FIELD_ERROR' ||
    errno === 1054 ||
    code === '42703' ||
    /unknown column|column .* does not exist|字段.*不存在|列.*不存在/.test(lower)
  ) {
    const colName = extractQuotedName(raw) || extractAfterKeyword(raw, /column|field|字段|列/i);
    return buildSqlExecutorError({
      error: colName ? `列「${colName}」不存在` : `列不存在：${truncateMessage(raw, 120)}`,
      code: 'COLUMN_NOT_FOUND',
      category: CATEGORY.SQL_SEMANTIC,
      hint: '请用 light-schema 核对字段名；SELECT 别名不可在同层 WHERE 中直接引用',
      sql,
      dataSource,
      raw,
    });
  }

  if (
    code === 'ER_PARSE_ERROR' ||
    errno === 1064 ||
    code === '42601' ||
    /syntax error|parse error|near "|语法错误/.test(lower)
  ) {
    return buildSqlExecutorError({
      error: `SQL 语法错误：${truncateMessage(raw, 160)}`,
      code: 'SQL_SYNTAX',
      category: CATEGORY.SQL_SYNTAX,
      hint: '请检查关键字拼写、括号匹配、引号与逗号；GaussDB/PostgreSQL 与 MySQL 方言可能不同',
      sql,
      dataSource,
      raw,
    });
  }

  if (
    code === 'ER_DUP_FIELDNAME' ||
    errno === 1060 ||
    /ambiguous column|column reference .* is ambiguous/.test(lower)
  ) {
    return buildSqlExecutorError({
      error: `列引用不明确：${truncateMessage(raw, 120)}`,
      code: 'AMBIGUOUS_COLUMN',
      category: CATEGORY.SQL_SEMANTIC,
      hint: '多表 JOIN 时请为列加表别名前缀（如 t.org_code）',
      sql,
      dataSource,
      raw,
    });
  }

  // ---- 权限（表/库级；勿匹配「Access denied for user」认证失败）----
  if (
    code === 'ER_TABLEACCESS_DENIED_ERROR' ||
    code === 'ER_DBACCESS_DENIED_ERROR' ||
    errno === 1142 ||
    errno === 1044 ||
    code === '42501' ||
    /permission denied for|tableaccess denied|command denied to user|无权访问表|没有权限访问/.test(lower)
  ) {
    return buildSqlExecutorError({
      error: `权限不足：${truncateMessage(raw, 120)}`,
      code: 'PERMISSION_DENIED',
      category: CATEGORY.PERMISSION,
      hint: '请确认数据源账号对目标表具备 SELECT 权限',
      sql,
      dataSource,
      raw,
    });
  }

  // ---- 查询超时（执行阶段，非建连）----
  if (
    code === 'ER_QUERY_TIMEOUT' ||
    code === '57014' ||
    /canceling statement due to statement timeout|query execution was interrupted|statement timeout|查询超时/.test(
      lower,
    )
  ) {
    return buildSqlExecutorError({
      error: `SQL 查询超时：${truncateMessage(raw, 120)}`,
      code: 'QUERY_TIMEOUT',
      category: CATEGORY.TIMEOUT,
      hint: '请缩小日期范围、加 LIMIT，或先聚合再查明细',
      sql,
      dataSource,
      raw,
    });
  }

  // ---- 连接 / 认证：复用连接测试分类，改写为 SQL 场景文案 ----
  if (isLikelyConnectionError(error, lower) && typeof formatConnectionTestError === 'function') {
    const conn = formatConnectionTestError(error, {
      type: dataSource?.type,
      host: context.dataSource?.host,
      port: context.dataSource?.port,
      database: context.dataSource?.database || dataSource?.database,
      username: context.dataSource?.username,
    });
    const category =
      conn.code === 'AUTH_FAILED' || conn.code === 'HOST_NOT_ALLOWED'
        ? CATEGORY.AUTH
        : conn.code === 'ETIMEDOUT'
          ? CATEGORY.TIMEOUT
          : conn.code === 'DATABASE_NOT_FOUND'
            ? CATEGORY.DATASOURCE_CONFIG
            : CATEGORY.CONNECTION;

    return buildSqlExecutorError({
      error: `SQL执行前连接数据源失败：${conn.error}`,
      code: conn.code || 'CONNECTION_FAILED',
      category,
      hint: conn.hint || '请先在数据源管理中做连接测试，确认主机/端口/账号可用',
      sql,
      dataSource,
      raw: conn.raw || raw,
    });
  }

  // ---- GaussDB / JDBC ----
  if (/gaussjdbcserver|jdbc bridge|classnotfoundexception|jvm/.test(lower)) {
    return buildSqlExecutorError({
      error: `SQL执行前 GaussDB JDBC 桥异常：${truncateMessage(raw, 120)}`,
      code: 'GAUSSDB_BRIDGE_ERROR',
      category: CATEGORY.CONNECTION,
      hint: '请确认服务端 Java 与 JDBC 驱动可用，并查看 API 服务日志',
      sql,
      dataSource,
      raw,
    });
  }

  // ---- 兜底 ----
  return buildSqlExecutorError({
    error: raw ? truncateMessage(raw, 200) : 'SQL执行失败',
    code: sqlState ? `SQLSTATE_${sqlState}` : errno ? `ERRNO_${errno}` : code || 'SQL_EXECUTION_FAILED',
    category: CATEGORY.UNKNOWN,
    hint: '请根据错误信息修正 SQL，或用 light-schema / knowledge-discovery 核对表字段后重试',
    sql,
    dataSource,
    raw,
  });
}

function isLikelyConnectionError(error, lower) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  const errno = error && typeof error === 'object' ? error.errno : undefined;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EHOSTUNREACH' ||
    code === 'ER_ACCESS_DENIED_ERROR' ||
    code === '28P01' ||
    code === 'ER_BAD_DB_ERROR' ||
    code === '3D000' ||
    errno === 2003 ||
    errno === 2002 ||
    errno === 1045 ||
    errno === 1049 ||
    /connection refused|connect econnrefused|timed out|getaddrinfo|password authentication failed|access denied for user|unknown database|ssl|tls|certificate/.test(
      lower,
    )
  );
}

function summarizeDataSource(ds) {
  if (!ds || typeof ds !== 'object') return undefined;
  return {
    id: ds._id != null ? String(ds._id) : ds.id != null ? String(ds.id) : undefined,
    name: ds.name,
    type: ds.type,
    database: ds.database,
  };
}

function extractRawMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) return String(error.message || '').trim();
  if (typeof error === 'object' && error.message) return String(error.message).trim();
  return String(error).trim();
}

function truncateMessage(message, maxLen) {
  const text = String(message || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

function extractQuotedName(message) {
  const m = String(message || '').match(/['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

function extractAfterKeyword(message, keywordRe) {
  const m = String(message || '').match(new RegExp(`${keywordRe.source}\\s+['"\`]?([\\w.]+)['"\`]?`, 'i'));
  return m ? m[1] : null;
}

module.exports = {
  CATEGORY,
  buildSqlExecutorError,
  stringifySqlExecutorError,
  formatSqlExecutorError,
};
