/**
 * 自定义数据源评估服务
 *
 * 用于对用户自定义数据集进行基准测试评估。
 * 与 BIRD 评估不同，自定义评估使用用户自己的数据源连接来执行 SQL。
 */

const { getDatDatasourceModel } = require('../../models/DatDatasource');

function loadDriver(moduleName, provider) {
  try {
    return require(moduleName);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(moduleName)) {
      throw new Error(
        `缺少 ${provider} 数据库驱动 ${moduleName}，请先在 api 服务安装对应依赖后再执行自定义评估`,
      );
    }
    throw error;
  }
}

class CustomEvaluationService {
  /**
   * 评估自定义数据集
   *
   * @param {object} options
   * @param {string} options.datasourceId - 数据源 ID
   * @param {Array} options.predictions - 预测结果 [{ index, sql, db_id }]
   * @param {Array} options.dataset - 原始数据集 [{ question_id, SQL, difficulty }]
   * @param {Function} [options.onProgress] - 进度回调
   * @returns {Promise<object>} 评估结果
   */
  static async evaluate({ datasourceId, predictions, dataset, onProgress }) {
    // 获取数据源配置
    const DatDatasource = await getDatDatasourceModel();
    const datasource = await DatDatasource.findById(datasourceId).lean();
    if (!datasource) {
      throw new Error(`数据源 ${datasourceId} 不存在`);
    }

    const provider = (datasource.provider || '').toLowerCase();
    const config = datasource.configuration || {};

    // 建立数据库连接
    const conn = await this.connectToUserDB(provider, config);

    try {
      const results = [];
      const total = predictions.length;

      for (let i = 0; i < predictions.length; i++) {
        const pred = predictions[i];
        const dataItem = dataset[i];
        const groundTruthSQL = dataItem?.SQL || '';

        try {
          let res = 0;
          if (pred.sql && groundTruthSQL) {
            res = await this.executeSQLPair(conn, provider, pred.sql, groundTruthSQL);
          }
          results.push({
            sql_idx: i,
            res,
            question_id: dataItem?.question_id,
            difficulty: dataItem?.difficulty || 'simple',
          });
        } catch (err) {
          console.error(
            `[CustomEvaluation] 第 ${i + 1} 题执行失败: ${err.message}`,
          );
          results.push({
            sql_idx: i,
            res: 0,
            question_id: dataItem?.question_id,
            difficulty: dataItem?.difficulty || 'simple',
            error: err.message,
          });
        }

        if (onProgress) {
          onProgress(Math.round(((i + 1) / total) * 100));
        }
      }

      // 计算 EX 准确率
      const exResult = this.calculateEX(results);
      return { EX: exResult };
    } finally {
      // 关闭连接
      await this.closeConnection(conn, provider);
    }
  }

  /**
   * 连接到用户数据库
   */
  static async connectToUserDB(provider, config) {
    // config 是 Map 类型（Mongoose），需要转换
    const conf =
      config instanceof Map ? Object.fromEntries(config) : config;

    if (provider === 'mysql') {
      const mysql = loadDriver('mysql2/promise', 'MySQL');
      const connection = await mysql.createConnection({
        host: conf.host || 'localhost',
        port: parseInt(conf.port || '3306', 10),
        user: conf.user || conf.username || 'root',
        password: conf.password || '',
        database: conf.database || '',
        connectTimeout: 10000,
      });
      return connection;
    }

    if (provider === 'postgresql' || provider === 'postgres') {
      const { Client } = loadDriver('pg', 'PostgreSQL');
      const client = new Client({
        host: conf.host || 'localhost',
        port: parseInt(conf.port || '5432', 10),
        user: conf.user || conf.username || 'postgres',
        password: conf.password || '',
        database: conf.database || '',
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      return client;
    }

    if (provider === 'sqlite') {
      const sqlite3 = loadDriver('sqlite3', 'SQLite');
      const { open } = loadDriver('sqlite', 'SQLite');
      const dbPath = conf.path || conf.database || '';
      const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
      });
      return db;
    }

    throw new Error(`不支持的数据库类型: ${provider}`);
  }

  /**
   * 执行 SQL 对比
   * @returns {number} 1 = 匹配, 0 = 不匹配
   */
  static async executeSQLPair(conn, provider, predictedSQL, groundTruthSQL) {
    const timeout = 30000; // 30 秒超时

    const executeWithTimeout = (queryFn) =>
      Promise.race([
        queryFn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('查询超时 (30s)')), timeout),
        ),
      ]);

    let predictedRows, groundTruthRows;

    if (provider === 'mysql') {
      [predictedRows] = await executeWithTimeout(() =>
        conn.execute(predictedSQL),
      );
      [groundTruthRows] = await executeWithTimeout(() =>
        conn.execute(groundTruthSQL),
      );
    } else if (provider === 'postgresql' || provider === 'postgres') {
      const predResult = await executeWithTimeout(() =>
        conn.query(predictedSQL),
      );
      predictedRows = predResult.rows;
      const gtResult = await executeWithTimeout(() =>
        conn.query(groundTruthSQL),
      );
      groundTruthRows = gtResult.rows;
    } else if (provider === 'sqlite') {
      predictedRows = await executeWithTimeout(() =>
        conn.all(predictedSQL),
      );
      groundTruthRows = await executeWithTimeout(() =>
        conn.all(groundTruthSQL),
      );
    } else {
      throw new Error(`不支持的数据库类型: ${provider}`);
    }

    // 对比结果集
    return this.compareResultSets(predictedRows, groundTruthRows);
  }

  /**
   * 对比两个结果集是否相同（集合比较，忽略行顺序）
   */
  static compareResultSets(predicted, groundTruth) {
    if (!predicted || !groundTruth) return 0;
    if (predicted.length !== groundTruth.length) return 0;

    // 将每行转为 JSON 字符串进行集合比较
    const stringify = (row) => {
      if (Array.isArray(row)) {
        return JSON.stringify(row.map((v) => (v === null ? null : String(v))));
      }
      // 对象形式（PostgreSQL / SQLite 返回的行）
      const keys = Object.keys(row).sort();
      const normalized = {};
      for (const k of keys) {
        normalized[k] = row[k] === null ? null : String(row[k]);
      }
      return JSON.stringify(normalized);
    };

    const predSet = new Set(predicted.map(stringify));
    const gtSet = new Set(groundTruth.map(stringify));

    if (predSet.size !== gtSet.size) return 0;
    for (const item of predSet) {
      if (!gtSet.has(item)) return 0;
    }
    return 1;
  }

  /**
   * 计算 EX 准确率，按难度分组
   */
  static calculateEX(results) {
    const simple = results.filter((r) => r.difficulty === 'simple');
    const moderate = results.filter((r) => r.difficulty === 'moderate');
    const challenging = results.filter((r) => r.difficulty === 'challenging');

    const safeAcc = (arr) =>
      arr.length > 0
        ? (arr.reduce((sum, r) => sum + r.res, 0) / arr.length) * 100
        : 0;

    const total = results.length;
    const totalCorrect = results.reduce((sum, r) => sum + r.res, 0);

    return {
      metric: 'EX',
      accuracy: total > 0 ? (totalCorrect / total) * 100 : 0,
      simple: safeAcc(simple),
      moderate: safeAcc(moderate),
      challenging: safeAcc(challenging),
      total,
    };
  }

  /**
   * 关闭数据库连接
   */
  static async closeConnection(conn, provider) {
    try {
      if (provider === 'mysql') {
        await conn.end();
      } else if (provider === 'postgresql' || provider === 'postgres') {
        await conn.end();
      } else if (provider === 'sqlite') {
        await conn.close();
      }
    } catch (err) {
      console.error('[CustomEvaluation] 关闭连接失败:', err.message);
    }
  }
}

module.exports = CustomEvaluationService;
