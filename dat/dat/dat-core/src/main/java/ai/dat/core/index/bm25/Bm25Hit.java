package ai.dat.core.index.bm25;

/**
 * BM25 检索命中结果。
 *
 * @param indexNumber 指标编码
 * @param score       BM25 分数（已乘 boost）
 */
public record Bm25Hit(String indexNumber, double score) {
}
