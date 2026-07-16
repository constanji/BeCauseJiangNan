/**
 * 将数据库连接测试的原始异常转为面向用户的结构化错误信息。
 * @param {unknown} error
 * @param {{ type?: string, host?: string, port?: number|string, database?: string, username?: string }} [config]
 * @returns {{ error: string, code: string, hint?: string, raw?: string }}
 */
function formatConnectionTestError(error, config = {}) {
  const raw = extractRawMessage(error);
  const type = String(config.type || '').toLowerCase();
  const host = config.host ? String(config.host) : '';
  const port = config.port != null ? String(config.port) : '';
  const database = config.database ? String(config.database) : '';
  const username = config.username ? String(config.username) : '';

  const errno = error && typeof error === 'object' ? error.errno : undefined;
  const sqlState = error && typeof error === 'object' ? error.sqlState : undefined;
  const code = error && typeof error === 'object' ? error.code : undefined;
  const lower = raw.toLowerCase();

  // ---- 网络 / 主机 ----
  if (
    code === 'ECONNREFUSED' ||
    errno === 2003 ||
    /connection refused|connect refused|拒绝连接/.test(lower)
  ) {
    const target = host && port ? `${host}:${port}` : '数据库服务器';
    return {
      error: `无法连接到 ${target}（连接被拒绝）`,
      code: 'ECONNREFUSED',
      hint: '请检查主机地址、端口号是否正确，数据库服务是否已启动，防火墙/安全组是否放行该端口',
      raw,
    };
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    errno === 2002 ||
    /timed out|timeout|连接超时|超时/.test(lower)
  ) {
    const target = host && port ? `${host}:${port}` : '数据库服务器';
    return {
      error: `连接 ${target} 超时（10 秒内未响应）`,
      code: 'ETIMEDOUT',
      hint: '请检查网络是否可达、VPN/专线是否正常，或尝试增大超时时间后重试',
      raw,
    };
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|host not found|无法解析/.test(lower)) {
    return {
      error: host ? `无法解析主机地址「${host}」` : '无法解析数据库主机地址',
      code: 'ENOTFOUND',
      hint: '请检查主机名/IP 是否拼写正确，DNS 是否可解析',
      raw,
    };
  }

  if (code === 'EHOSTUNREACH' || /host unreachable|no route to host/.test(lower)) {
    return {
      error: host ? `主机「${host}」不可达` : '数据库主机不可达',
      code: 'EHOSTUNREACH',
      hint: '请检查网络路由、VPN 或内网访问权限',
      raw,
    };
  }

  // ---- 认证 ----
  if (
    code === 'ER_ACCESS_DENIED_ERROR' ||
    errno === 1045 ||
    code === '28P01' ||
    /access denied|authentication failed|password authentication failed|invalid authorization specification|用户名或密码|认证失败/.test(
      lower,
    )
  ) {
    const who = username ? `用户「${username}」` : '当前用户';
    return {
      error: `${who} 认证失败（用户名或密码错误）`,
      code: 'AUTH_FAILED',
      hint: '请核对用户名、密码是否正确；若密码曾用旧密钥加密，请重新输入并保存',
      raw,
    };
  }

  if (
    code === 'ER_HOST_NOT_PRIVILEGED' ||
    errno === 1130 ||
    /host .* is not allowed|not allowed to connect/.test(lower)
  ) {
    return {
      error: `客户端主机未被允许连接数据库（用户：${username || '未知'}）`,
      code: 'HOST_NOT_ALLOWED',
      hint: '请在数据库侧为用户授权来自当前应用服务器 IP 的访问权限',
      raw,
    };
  }

  // ---- 数据库 / Schema ----
  if (
    code === 'ER_BAD_DB_ERROR' ||
    errno === 1049 ||
    code === '3D000' ||
    /unknown database|database .* does not exist|does not exist/.test(lower)
  ) {
    const dbLabel = database ? `「${database}」` : '';
    return {
      error: `数据库${dbLabel}不存在或当前用户无权访问`,
      code: 'DATABASE_NOT_FOUND',
      hint: '请检查数据库名称拼写，或确认该用户是否有访问权限',
      raw,
    };
  }

  // ---- SSL / TLS ----
  if (/ssl|tls|certificate|cert|handshake/.test(lower)) {
    return {
      error: 'SSL/TLS 连接失败',
      code: 'SSL_ERROR',
      hint: '请检查 SSL 开关、CA/证书配置，或尝试关闭「验证服务器证书」后重试',
      raw,
    };
  }

  // ---- GaussDB / JDBC 桥 ----
  if (/gaussjdbcserver|jdbc bridge|jvm|java\.lang|classnotfoundexception/.test(lower)) {
    return {
      error: 'GaussDB JDBC 桥接服务异常',
      code: 'GAUSSDB_BRIDGE_ERROR',
      hint: '请确认服务端已安装 Java 运行环境、JDBC 驱动文件完整，并查看服务日志',
      raw,
    };
  }

  if (type === 'gaussdb' && /fatal:|psqlerror|connection to/.test(lower)) {
    return {
      error: `GaussDB 连接失败：${truncateMessage(raw, 120)}`,
      code: 'GAUSSDB_CONNECTION_FAILED',
      hint: '请核对 GaussDB 主机、端口（常见 8000）、库名及企业安全协议配置',
      raw,
    };
  }

  // ---- 依赖缺失（由上层显式返回，此处兜底）----
  if (/mysql2|pg 包未安装|not found.*require/.test(lower)) {
    return {
      error: '数据库驱动未安装，服务端缺少必要依赖',
      code: 'DRIVER_MISSING',
      hint: '请联系管理员在 API 服务中安装 mysql2 或 pg 驱动包',
      raw,
    };
  }

  // ---- SQL 状态码兜底 ----
  if (sqlState) {
    return {
      error: `数据库返回错误（SQLState: ${sqlState}）${raw ? `：${truncateMessage(raw, 100)}` : ''}`,
      code: `SQLSTATE_${sqlState}`,
      hint: buildTypeHint(type),
      raw,
    };
  }

  if (errno) {
    return {
      error: `数据库连接失败（错误码 ${errno}）${raw ? `：${truncateMessage(raw, 100)}` : ''}`,
      code: `ERRNO_${errno}`,
      hint: buildTypeHint(type),
      raw,
    };
  }

  if (raw) {
    return {
      error: truncateMessage(raw, 200),
      code: 'CONNECTION_FAILED',
      hint: buildTypeHint(type),
      raw,
    };
  }

  return {
    error: '连接测试失败，未返回具体错误信息',
    code: 'UNKNOWN',
    hint: buildTypeHint(type),
    raw: '',
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
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

function buildTypeHint(type) {
  if (type === 'mysql') return '请核对 MySQL 主机、端口（常见 3306）、库名、用户名与密码';
  if (type === 'postgresql') return '请核对 PostgreSQL 主机、端口（常见 5432）、库名、用户名与密码';
  if (type === 'gaussdb') return '请核对 GaussDB 主机、端口（常见 8000）、库名、用户名与密码';
  return '请核对数据库类型、连接地址、端口、库名、用户名与密码';
}

/**
 * 统一连接测试 API 响应体（success / failure 均含 error + message）
 */
function buildConnectionTestApiPayload(result) {
  if (result.success) {
    return {
      success: true,
      status: 'connected',
      message: '连接测试成功',
    };
  }

  const error = result.error || '连接测试失败';
  return {
    success: false,
    status: 'disconnected',
    message: error,
    error,
    code: result.code || 'CONNECTION_FAILED',
    ...(result.hint ? { hint: result.hint } : {}),
  };
}

module.exports = {
  formatConnectionTestError,
  buildConnectionTestApiPayload,
};
