/**
 * gaussdbJdbcBridge.js
 *
 * 通过 Java 子进程 + gsjdbc4.jar 连接企业定制 GaussDB（华为安全协议）。
 * 复用 resultMCP 的 Java 桥方案，改造为支持 Because 多数据源场景：
 * 每次调用按 dataSource 对象动态传入连接参数，而非读取静态 env var。
 *
 * 依赖：
 *   - Because-2.0/drivers/gaussdb-jdbc/GaussJdbcQuery.class（Dockerfile 中 javac 编译）
 *   - Because-2.0/drivers/lib/gsjdbc4-1.0.jar（已打包进镜像）
 */

const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_DIR = path.join(__dirname, '..', 'drivers', 'gaussdb-jdbc');
const DEFAULT_JAR = path.join(__dirname, '..', 'drivers', 'lib', 'gsjdbc4-1.0.jar');
const DEFAULT_TIMEOUT_MS = 240000;

/**
 * 通过 Java JDBC 桥执行 SQL，返回 { rows: [...] }
 *
 * @param {string} sql - 要执行的 SQL
 * @param {string[]} params - 绑定参数（字符串数组）
 * @param {object} dataSource - DataSource 对象 { host, port, database, username, ssl? }
 * @param {string} password - 已解密的明文密码
 * @returns {Promise<{ rows: any[] }>}
 */
function gaussdbJdbcQuery(sql, params = [], dataSource, password) {
  return new Promise((resolve, reject) => {
    const jarPath = process.env.GAUSSDB_JDBC_JAR || DEFAULT_JAR;
    const javaBin = process.env.JAVA_BIN || 'java';
    const classPath = [BRIDGE_DIR, jarPath].join(path.delimiter);
    const timeoutMs = parseInt(process.env.GAUSSDB_JDBC_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;

    const b64Sql = Buffer.from(sql, 'utf8').toString('base64');
    const b64Params = Buffer.from(
      JSON.stringify((params || []).map((v) => String(v))),
      'utf8',
    ).toString('base64');

    const jdbcUrl =
      `jdbc:${process.env.GAUSSDB_JDBC_PROTOCOL || 'postgresql'}` +
      `://${dataSource.host}:${dataSource.port || 8000}/${dataSource.database}`;

    const childEnv = {
      ...process.env,
      DB_HOST: String(dataSource.host || ''),
      DB_PORT: String(dataSource.port || 8000),
      DB_USER: String(dataSource.username || ''),
      DB_PASSWORD: String(password || ''),
      DB_NAME: String(dataSource.database || ''),
      GAUSSDB_JDBC_URL: jdbcUrl,
      GAUSSDB_JDBC_JAR: jarPath,
      // Java JDBC 层也有 statement.setQueryTimeout；之前默认 45s 会主动 cancel SQL。
      // 外层 Node 仍有进程级超时兜底，默认 240s。
      GAUSSDB_JDBC_QUERY_TIMEOUT_SEC: process.env.GAUSSDB_JDBC_QUERY_TIMEOUT_SEC || '180',
    };

    if (dataSource.ssl && dataSource.ssl.enabled) {
      childEnv.DB_SSL = 'true';
      if (dataSource.ssl.rejectUnauthorized === false) {
        childEnv.DB_SSL_REJECT_UNAUTHORIZED = 'false';
        childEnv.DB_SSLMODE = 'require';
      }
      if (dataSource.ssl.ca) childEnv.DB_SSL_CA = dataSource.ssl.ca;
      if (dataSource.ssl.cert) childEnv.DB_SSL_CERT = dataSource.ssl.cert;
      if (dataSource.ssl.key) childEnv.DB_SSL_KEY = dataSource.ssl.key;
    }

    const args = [
      '-Dfile.encoding=UTF-8',
      '-Dstdout.encoding=UTF-8',
      '-cp', classPath,
      'GaussJdbcQuery',
      b64Sql,
      b64Params,
    ];
    const child = spawn(javaBin, args, {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const previewSql = String(sql || '').replace(/\s+/g, ' ').slice(0, 180);
    const startedAt = Date.now();
    let finished = false;
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`GaussDB JDBC 查询超时(${Date.now() - startedAt}ms): ${previewSql}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const elapsed = Date.now() - startedAt;

      if (code !== 0) {
        const errMsg = stderr.trim() || stdout.trim();
        reject(new Error(`GaussDB JDBC 查询失败(code=${code}, elapsed=${elapsed}ms, sql=${previewSql}): ${errMsg}`));
        return;
      }

      try {
        const payload = JSON.parse(stdout);
        resolve(payload.rows || []);
      } catch (err) {
        reject(new Error(`GaussDB JDBC 返回解析失败: ${err.message}; stdout=${stdout.slice(0, 500)}`));
      }
    });
  });
}

/**
 * 简单连通性测试：执行 SELECT 1
 */
async function gaussdbTestConnection(dataSource, password) {
  const rows = await gaussdbJdbcQuery('SELECT 1', [], dataSource, password);
  return { success: true, rows };
}

module.exports = { gaussdbJdbcQuery, gaussdbTestConnection };
