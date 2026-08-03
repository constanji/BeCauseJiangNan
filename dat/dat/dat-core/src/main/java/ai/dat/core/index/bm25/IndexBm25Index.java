package ai.dat.core.index.bm25;

import ai.dat.core.contentstore.data.IndexEntry;
import com.huaban.analysis.jieba.JiebaSegmenter;
import com.huaban.analysis.jieba.SegToken;
import lombok.extern.slf4j.Slf4j;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 进程内 BM25 倒排索引，per-project 一份。
 * <p>
 * 中文使用 jieba 分词 + 字符 2-gram 兜底（捕获 jieba 未命中的行话如"两增两控"）。
 * BM25 公式参考 BM25混合检索.md：K1=1.5, B=0.75。
 * DF（文档频率）在建索引时预计算 HashMap，query 时 O(1) 查表。
 *
 * @Author DAT Team
 * @Date 2026/6/24
 */
@Slf4j
public class IndexBm25Index {

    private static final double K1 = 1.5;   // 词频饱和参数
    private static final double B  = 0.75;  // 文档长度归一化系数

    // ── 索引数据 ──
    // indexNumber → weighted token list (权重高的 token 在列表中出现多次)
    private final Map<String, List<String>> docTokens = new HashMap<>();
    // term → 出现该词条的文档数（预计算）
    private final Map<String, Integer> dfMap = new HashMap<>();
    // 文档总数
    private int N = 0;
    // 平均文档长度（以 token 数计）
    private double avgdl = 1.0;

    // ── 分词器（线程安全，可复用） ──
    private static final JiebaSegmenter JIEBA = new JiebaSegmenter();

    // ── 字段权重 ──
    private static final double W_STANDARD_NAME = 3.0;
    private static final double W_STEM          = 2.5;
    private static final double W_ALIASES       = 2.0;

    /**
     * 通用文本索引：从 Map(key → text) 构建索引，用于机构等非指标文本。
     * 不做字段权重（全部 boost=1.0），只做 jieba + 2-gram 分词。
     */
    public void buildFromTextMap(Map<String, String> entries) {
        clear();
        if (entries == null || entries.isEmpty()) return;
        Map<String, List<String>> tokenMap = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : entries.entrySet()) {
            if (e.getKey() == null || e.getValue() == null) continue;
            List<String> tokens = tokenize(e.getValue());
            if (!tokens.isEmpty()) {
                tokenMap.put(e.getKey(), tokens);
            }
        }
        docTokens.putAll(tokenMap);
        N = docTokens.size();
        recalcDf();
        avgdl = docTokens.values().stream().mapToInt(List::size).average().orElse(1.0);
    }

    /**
     * 全量建索引。
     * 三步：对每条 doc 分词加权 → 预计算 DF + avgdl → 存储
     */
    public void buildAll(List<IndexEntry> entries) {
        clear();
        if (entries == null || entries.isEmpty()) return;

        // 逐条分词
        Map<String, List<String>> tokenMap = new LinkedHashMap<>();
        for (IndexEntry e : entries) {
            if (e == null || e.getIndexNumber() == null) continue;
            List<String> tokens = tokenizeWithWeights(e);
            if (!tokens.isEmpty()) {
                tokenMap.put(e.getIndexNumber(), tokens);
            }
        }
        // 一次性替换
        docTokens.putAll(tokenMap);
        N = docTokens.size();

        // 预计算 DF
        recalcDf();
        // 计算 avgdl
        avgdl = docTokens.values().stream()
                .mapToInt(List::size)
                .average()
                .orElse(1.0);
        log.info("BM25 index built: {} docs, avgdl={}, df terms={}", N, String.format("%.1f", avgdl), dfMap.size());
    }

    /** 增量新增/更新 — 逐条更新 DF 与 avgdl */
    public void addAll(List<IndexEntry> entries) {
        if (entries == null || entries.isEmpty()) return;
        for (IndexEntry e : entries) {
            if (e == null || e.getIndexNumber() == null) continue;
            // 先删旧 token（若存在）
            removeOne(e.getIndexNumber());
            // 加新
            List<String> tokens = tokenizeWithWeights(e);
            if (tokens.isEmpty()) continue;
            docTokens.put(e.getIndexNumber(), tokens);
        }
        N = docTokens.size();
        recalcDf();
        avgdl = docTokens.values().stream()
                .mapToInt(List::size)
                .average()
                .orElse(1.0);
    }

    /** 批量删除 */
    public void removeAll(Collection<String> indexNumbers) {
        if (indexNumbers == null || indexNumbers.isEmpty()) return;
        for (String num : indexNumbers) {
            removeOne(num);
        }
        N = docTokens.size();
        recalcDf();
        avgdl = N == 0 ? 1.0 : docTokens.values().stream()
                .mapToInt(List::size)
                .average()
                .orElse(1.0);
    }

    private void removeOne(String indexNumber) {
        List<String> old = docTokens.remove(indexNumber);
        if (old == null) return;
        // 从 dfMap 中减去该 doc 的贡献
        Set<String> uniques = new HashSet<>(old);
        for (String term : uniques) {
            Integer cur = dfMap.get(term);
            if (cur != null) {
                int v = cur - 1;
                if (v <= 0) dfMap.remove(term);
                else dfMap.put(term, v);
            }
        }
    }

    /** 清空 */
    public void clear() {
        docTokens.clear();
        dfMap.clear();
        N = 0;
        avgdl = 1.0;
    }

    // ─── 检索 ────────────────────────────────────────────────────────

    /**
     * BM25 检索（默认权重 1.0）。
     * @param query 用户查询文本
     * @param topK  返回条数上限
     * @return 按 BM25 分数降序的结果
     */
    public List<Bm25Hit> search(String query, int topK) {
        return search(query, topK, 1.0);
    }

    /**
     * BM25 检索（带权重乘数）。
     * @param boost 权重乘数（query_expansions 使用 0.3，原始 query 使用 1.0）
     */
    public List<Bm25Hit> search(String query, int topK, double boost) {
        if (query == null || query.isBlank() || topK <= 0 || N == 0) {
            return Collections.emptyList();
        }

        List<String> queryTerms = tokenize(query);
        if (queryTerms.isEmpty()) return Collections.emptyList();

        List<Bm25Hit> results = new ArrayList<>();
        for (Map.Entry<String, List<String>> doc : docTokens.entrySet()) {
            double score = bm25Score(queryTerms, doc.getValue()) * boost;
            if (score > 0) {
                results.add(new Bm25Hit(doc.getKey(), score));
            }
        }

        return results.stream()
                .sorted(Comparator.comparingDouble(Bm25Hit::score).reversed())
                .limit(topK)
                .collect(Collectors.toList());
    }

    // ─── BM25 公式（参考 BM25混合检索.md） ──────────────────────────

    private double bm25Score(List<String> queryTerms, List<String> docTermList) {
        Map<String, Long> tf = docTermList.stream()
                .collect(Collectors.groupingBy(t -> t, Collectors.counting()));
        double docLen = docTermList.size();

        double score = 0.0;
        for (String term : queryTerms) {
            int df = dfMap.getOrDefault(term, 0);
            if (df == 0) continue;

            // IDF：文档频率越低，辨别力越强
            double idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

            // TF 饱和：词频越高加分越慢，防止词语堆砌
            double termFreq = tf.getOrDefault(term, 0L);
            double numerator   = termFreq * (K1 + 1);
            double denominator = termFreq + K1 * (1 - B + B * (docLen / avgdl));

            score += idf * (numerator / denominator);
        }
        return score;
    }

    // ─── 分词（jieba + 2-gram + 标点切分） ──────────────────────────

    /** 对 IndexEntry 做加权分词：权重高的字段 token 在列表中出现多次 */
    private List<String> tokenizeWithWeights(IndexEntry entry) {
        List<String> result = new ArrayList<>();
        String name = entry.getStandardName();
        if (name == null || name.isBlank()) return result;
        name = name.trim();

        // standardName — boost 3.0 (重复 3 次 token)
        List<String> nameTokens = tokenize(name);
        for (int i = 0; i < (int) W_STANDARD_NAME; i++) {
            result.addAll(nameTokens);
        }

        // stem（去括号/口径后的主干）— boost 2.5
        String stem = stem(name);
        if (!stem.equals(name)) {
            List<String> stemTokens = tokenize(stem);
            for (int i = 0; i < (int) W_STEM; i++) {
                result.addAll(stemTokens);
            }
        } else {
            // stem 与 name 相同 → 不额外加重，只补 1.5 次（相对 standardName 已是 2.5）
            List<String> stemTokens = tokenize(stem);
            for (int i = 0; i < (int) (W_STEM - 3.0); i++) {
                result.addAll(stemTokens);
            }
        }

        // aliases — boost 2.0
        if (entry.getAliases() != null && !entry.getAliases().isEmpty()) {
            for (String alias : entry.getAliases()) {
                if (alias == null || alias.isBlank()) continue;
                List<String> aliasTokens = tokenize(alias.trim());
                for (int i = 0; i < (int) W_ALIASES; i++) {
                    result.addAll(aliasTokens);
                }
            }
        }

        return result;
    }

    /** 提取主干：去口径后缀 "(人行口径)" / "(银监口径)" / "(省联社口径)"，再去所有括号内容 */
    private static String stem(String standardName) {
        if (standardName == null) return "";
        String s = standardName
                .replace("(人行口径)", "")
                .replace("(人民银行口径)", "")
                .replace("(银监口径)", "")
                .replace("(监管口径)", "")
                .replace("(省联社口径)", "")
                .replace("（人行口径）", "")
                .replace("（银监口径）", "")
                .replace("（监管口径）", "")
                .replace("（省联社口径）", "")
                .trim();
        // 去所有括号内容（保留括号外的主干）
        s = s.replaceAll("[（(][^)）]*[)）]", "").trim();
        return s;
    }

    /** jieba 分词 + 字符 2-gram + 标点切分 */
    private static List<String> tokenize(String text) {
        if (text == null || text.isBlank()) return Collections.emptyList();

        // 1. jieba 分词
        List<String> tokens = new ArrayList<>();
        try {
            List<SegToken> segTokens = JIEBA.process(text, JiebaSegmenter.SegMode.SEARCH);
            for (SegToken t : segTokens) {
                String w = t.word.trim();
                if (!w.isEmpty() && !isPunctuationOnly(w)) {
                    tokens.add(w);
                }
            }
        } catch (Exception e) {
            // jieba 异常时降级为纯 2-gram
            log.warn("jieba tokenize failed for text: {}", text.substring(0, Math.min(50, text.length())));
            tokens.clear();
        }

        // 如果有分词结果，追加字符 2-gram 作为兜底
        // （捕获 jieba 未命中的行话组合，如"两增两控" → "两增"+"增两"+"两控"）
        List<String> twoGrams = char2grams(text);
        tokens.addAll(twoGrams);

        // 去重（保留第一次出现的顺序）
        List<String> dedup = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String t : tokens) {
            if (!seen.contains(t)) {
                dedup.add(t);
                seen.add(t);
            }
        }
        return dedup;
    }

    /** 字符 2-gram：对中文连续字符段做滑动窗口 */
    private static List<String> char2grams(String text) {
        List<String> result = new ArrayList<>();
        if (text == null || text.length() < 2) return result;

        // 只对 ASCII 之外的连续字符段做 2-gram
        StringBuilder segment = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.UnicodeScript.of(c) == Character.UnicodeScript.HAN
                    || c > 127) {
                segment.append(c);
            } else {
                flush2grams(segment, result, 2);
                segment.setLength(0);
            }
        }
        flush2grams(segment, result, 2);
        return result;
    }

    private static void flush2grams(StringBuilder sb, List<String> out, int n) {
        if (sb.length() < n) return;
        for (int i = 0; i <= sb.length() - n; i++) {
            out.add(sb.substring(i, i + n));
        }
    }

    /** 是否全为标点/空白 */
    private static boolean isPunctuationOnly(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (!Character.isWhitespace(c) && !isPunct(c)) {
                return false;
            }
        }
        return true;
    }

    private static boolean isPunct(char c) {
        return c == '(' || c == ')' || c == '（' || c == '）'
                || c == '-' || c == '/' || c == '、' || c == '，'
                || c == '。' || c == '；' || c == '：' || c == ','
                || c == '.' || c == ';' || c == ':';
    }

    // ─── 预计算 DF ─────────────────────────────────────────────────

    /** 全量重算 DF 表（一次遍历所有 doc，O(总 token 数)） */
    private void recalcDf() {
        dfMap.clear();
        for (Map.Entry<String, List<String>> entry : docTokens.entrySet()) {
            // 每条 doc 每个 term 只计 1 次
            Set<String> uniqueTerms = new HashSet<>(entry.getValue());
            for (String term : uniqueTerms) {
                dfMap.merge(term, 1, Integer::sum);
            }
        }
    }
}
