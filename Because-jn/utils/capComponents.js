/**
 * 通用的「排序 + 截断 + 省略摘要」工具。
 *
 * 用于所有会按维度值/子指标展开明细列表的归因输出（加法方向影响、指标分解等），
 * 统一解决两个问题：
 * 1. 高基数场景下明细列表无上限，撑爆上下文
 * 2. 只截断不留摘要时，模型看不到被省略部分的方向。因此除了 total/omitted
 *    计数外，还输出被省略部分的增加/减少聚合（omitted_summary）。
 */

/**
 * @param {Object[]} components - 待截断的明细数组
 * @param {Object} [options]
 * @param {number} [options.maxComponents=10] - 保留条数上限；传 Infinity 关闭截断
 * @param {string} [options.changeField='change'] - 用于排序/聚合的数值字段名
 * @returns {{
 *   output: Object[],
 *   totalComponents: number,
 *   omittedComponents: number,
 *   omittedSummary?: { count: number, net_change: number, positive_count: number,
 *     decrease_count: number, increase_total: number, decrease_total: number },
 * }}
 */
function capComponentsWithSummary(components, options = {}) {
  const { maxComponents = 10, changeField = 'change' } = options;

  const sorted = [...components].sort(
    (a, b) => Math.abs(Number(b[changeField]) || 0) - Math.abs(Number(a[changeField]) || 0),
  );
  const totalComponents = sorted.length;
  const shouldCap = Number.isFinite(maxComponents) && totalComponents > maxComponents;
  const output = shouldCap ? sorted.slice(0, maxComponents) : sorted;
  const omittedComponents = shouldCap ? totalComponents - output.length : 0;

  let omittedSummary;
  if (shouldCap && omittedComponents > 0) {
    const omitted = sorted.slice(maxComponents);
    let increaseCount = 0;
    let decreaseCount = 0;
    let increaseTotal = 0;
    let decreaseTotal = 0;
    for (const item of omitted) {
      const v = Number(item[changeField]) || 0;
      if (v > 0) {
        increaseCount += 1;
        increaseTotal += v;
      } else if (v < 0) {
        decreaseCount += 1;
        decreaseTotal += Math.abs(v);
      }
    }
    omittedSummary = {
      count: omitted.length,
      net_change: Number((increaseTotal - decreaseTotal).toFixed(4)),
      increase_count: increaseCount,
      decrease_count: decreaseCount,
      increase_total: Number(increaseTotal.toFixed(4)),
      decrease_total: Number(decreaseTotal.toFixed(4)),
    };
  }

  return { sorted, output, totalComponents, omittedComponents, omittedSummary };
}

module.exports = { capComponentsWithSummary };
