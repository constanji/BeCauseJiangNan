/**
 * 通用的「排序 + 截断 + 省略摘要」工具。
 *
 * 用于所有会按维度值/子指标展开明细列表的归因输出（加法贡献度、指标分解等），
 * 统一解决两个问题：
 * 1. 高基数场景下明细列表无上限，撑爆上下文
 * 2. 只截断不留摘要时，模型看不到被省略部分的方向（可能被截断的尾部集中正贡献
 *    或负贡献，导致模型误判整体走势）——因此除了 total/omitted 计数外，还输出
 *    被省略部分的正负贡献聚合（omitted_summary），让模型即使看不到明细也知道方向。
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
 *     negative_count: number, positive_total: number, negative_total: number },
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
    let positiveCount = 0;
    let negativeCount = 0;
    let positiveTotal = 0;
    let negativeTotal = 0;
    for (const item of omitted) {
      const v = Number(item[changeField]) || 0;
      if (v >= 0) {
        positiveCount += 1;
        positiveTotal += v;
      } else {
        negativeCount += 1;
        negativeTotal += v;
      }
    }
    omittedSummary = {
      count: omitted.length,
      net_change: Number((positiveTotal + negativeTotal).toFixed(4)),
      positive_count: positiveCount,
      negative_count: negativeCount,
      positive_total: Number(positiveTotal.toFixed(4)),
      negative_total: Number(negativeTotal.toFixed(4)),
    };
  }

  return { sorted, output, totalComponents, omittedComponents, omittedSummary };
}

module.exports = { capComponentsWithSummary };
