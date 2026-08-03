package ai.dat.core.index.provider;

import ai.dat.core.contentstore.data.IndexEntry;

import java.util.List;

/**
 * 指标库候选检索的抽象。
 * <p>由 {@code IndexContextResolver} 在每次问数请求中调用,把用户自然语言中的"在编人数""存款余额"
 * 这种业务概念,精确映射到一组候选 {@link IndexEntry},供 SQL 生成阶段作为
 * {@code index_number IN (...)} 的候选集。
 *
 * <p>实现位于 dat-datastore 层(Mongo + ContentStore 向量库混合)。dat-core 只持有接口,
 * 保持核心包对 Spring/Mongo 解耦。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
public interface IndexEntryProvider {

    /**
     * 召回项目内与问题相关的候选指标(旧版按词召回,保留供回退用)。
     * <p>新版意图分类走 {@link #listAll(String)} 全量,LLM 自行从全量库里选 selected_index_numbers,
     * 不再依赖问题词的子串/向量召回,从根本上避免"问题文本与标准名带括号差异导致 miss"的问题。
     *
     * @param projectId 项目 ID
     * @param question  用户问题原文
     * @return 候选列表,空集合表示无匹配。永不返回 null。
     */
    List<IndexEntry> retrieve(String projectId, String question);

    /**
     * 列出项目内全部指标(LightSchema 风格——把决策权交给意图分类 LLM)。
     * <p>对比 {@link #retrieve}: retrieve 在 Resolver 阶段先做关键词/向量过滤后只给 LLM 看 top-K,
     * 一旦标准名与问题文本有形态差异(全角/半角括号、口径后缀缺失等)就会 miss;
     * listAll 不做过滤,LLM 在意图分类阶段对照全量指标自行选择,准确率显著提升。
     *
     * <p>规模在 500 条以内时一次性吞下对意图分类 LLM 的 token 影响可接受;
     * 真正放进 SQL 生成阶段 prompt 的 indexCandidates 会被 selected_index_numbers 窄化。
     *
     * @param projectId 项目 ID
     * @return 全部指标条目,永不返回 null。
     */
    List<IndexEntry> listAll(String projectId);
}
