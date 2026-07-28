/**
 * DataSourceCacheRegistry
 *
 * 数据源的连接池/JDBC 桥进程分散缓存在多处（database-schema-tool、
 * sql-executor-tool 各有 jn/2.0/3.0 三份镜像，以及 DataSourceQueryService），
 * 且历史上互相独立、按数据源 ID 永久缓存、没有失效机制：编辑或删除数据源后，
 * 只要进程不重启，这些缓存都会继续使用旧的 host/密码/库名。
 *
 * 这里不改变各处已有的缓存结构，只提供一个轻量的共享"版本号"：
 *   - 数据源被更新/删除时，版本号 +1（由 DataSourceController 调用）。
 *   - 各缓存在命中时对比自己缓存时记下的版本号与当前版本号，
 *     不一致就淘汰旧连接（关闭 pool / 杀掉 GaussDB JDBC 子进程）后按最新配置重建。
 *   - 未被更新的数据源版本号不变，缓存行为与之前完全一致，无额外开销、无破坏性。
 */
'use strict';

/** @type {Map<string, number>} */
const revisions = new Map();

/**
 * 数据源配置发生变化（更新/删除）时调用，使所有缓存该数据源连接的地方失效。
 * @param {string} dataSourceId
 * @returns {number} 新版本号
 */
function bumpDataSourceRevision(dataSourceId) {
  if (!dataSourceId) {
    return 0;
  }
  const id = String(dataSourceId);
  const next = (revisions.get(id) || 0) + 1;
  revisions.set(id, next);
  return next;
}

/**
 * 获取数据源当前版本号，默认 0（表示从未被标记为"已变更"）。
 * @param {string} dataSourceId
 * @returns {number}
 */
function getDataSourceRevision(dataSourceId) {
  if (!dataSourceId) {
    return 0;
  }
  return revisions.get(String(dataSourceId)) || 0;
}

/**
 * 清理版本号记录（数据源彻底删除后可选调用，避免 Map 无限增长；不调用也不影响正确性）。
 * @param {string} dataSourceId
 */
function clearDataSourceRevision(dataSourceId) {
  if (!dataSourceId) {
    return;
  }
  revisions.delete(String(dataSourceId));
}

module.exports = {
  bumpDataSourceRevision,
  getDataSourceRevision,
  clearDataSourceRevision,
};
