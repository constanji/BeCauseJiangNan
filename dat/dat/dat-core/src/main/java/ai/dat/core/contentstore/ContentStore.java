package ai.dat.core.contentstore;

import ai.dat.core.contentstore.data.*;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.rag.content.aggregator.ContentAggregator;
import dev.langchain4j.rag.content.aggregator.DefaultContentAggregator;
import dev.langchain4j.rag.content.retriever.ContentRetriever;

import java.util.Collection;
import java.util.Collections;
import java.util.List;

/**
 * 内容存储接口类
 *
 * @Author JunjieM
 * @Date 2025/6/25
 */
public interface ContentStore {
    // ---------------问题和SQL对-------------------

    default String addSql(QuestionSqlPair sqlPair) {
        return addSqls(List.of(sqlPair)).get(0);
    }

    List<String> addSqls(List<QuestionSqlPair> sqlPairs);

    ContentRetriever getSqlContentRetriever();

    default ContentAggregator getSqlContentAggregator() {
        return new DefaultContentAggregator();
    }

    List<QuestionSqlPair> retrieveSql(String question);

    boolean isSql(TextSegment textSegment);

    default void removeSql(String id) {
        removeSqls(List.of(id));
    }

    void removeSqls(Collection<String> ids);

    void removeAllSqls();

    List<QuestionSqlPair> allSqls();

    /**
     * 获取所有 SQL 示例对（带 ID）
     * 用于支持前端根据 ID 进行删除操作
     */
    List<QuestionSqlPairWithId> allSqlsWithId();

    // ---------------词和同义词对-------------------

    default String addSyn(WordSynonymPair synonymPair) {
        return addSyns(List.of(synonymPair)).get(0);
    }

    List<String> addSyns(List<WordSynonymPair> synonymPairs);

    ContentRetriever getSynContentRetriever();

    default ContentAggregator getSynContentAggregator() {
        return new DefaultContentAggregator();
    }

    List<WordSynonymPair> retrieveSyn(String question);

    boolean isSyn(TextSegment textSegment);

    default void removeSyn(String id) {
        removeSyns(List.of(id));
    }

    void removeSyns(Collection<String> ids);

    void removeAllSyns();

    List<WordSynonymPair> allSyns();

    /**
     * 获取所有同义词对（带 ID）
     * 用于支持前端根据 ID 进行删除操作
     */
    List<WordSynonymPairWithId> allSynsWithId();

    // ---------------业务知识（术语或定义）-------------------

    default String addDoc(String doc) {
        return addDocs(List.of(doc)).get(0);
    }

    List<String> addDocs(List<String> docs);

    ContentRetriever getDocContentRetriever();

    default ContentAggregator getDocContentAggregator() {
        return new DefaultContentAggregator();
    }

    List<String> retrieveDoc(String question);

    boolean isDoc(TextSegment textSegment);

    default void removeDoc(String id) {
        removeDocs(List.of(id));
    }

    void removeDocs(Collection<String> ids);

    void removeAllDocs();

    List<String> allDocs();

    /**
     * 获取所有业务知识文档（带 ID）
     * 用于支持前端根据 ID 进行删除操作
     */
    List<DocWithId> allDocsWithId();

    // ---------------Light Schema (极简DDL)-------------------

    /**
     * 添加 Light Schema
     */
    default String addLightSchema(LightSchema schema) {
        return addLightSchemas(List.of(schema)).get(0);
    }

    /**
     * 批量添加 Light Schema
     */
    default List<String> addLightSchemas(List<LightSchema> schemas) {
        throw new UnsupportedOperationException("Light Schema not supported in this implementation");
    }

    /**
     * 批量添加 Light Schema，写入指定 datasourceId 元数据用于多数据源隔离。
     * 默认实现委托到无 datasourceId 版本（向后兼容）。
     */
    default List<String> addLightSchemas(String datasourceId, List<LightSchema> schemas) {
        return addLightSchemas(schemas);
    }

    /**
     * 获取所有 Light Schema
     */
    default List<LightSchema> allLightSchemas() {
        return Collections.emptyList();
    }

    /**
     * 获取指定 datasourceId 的所有 Light Schema。
     */
    default List<LightSchema> allLightSchemas(String datasourceId) {
        return allLightSchemas();
    }

    /**
     * 清空所有 Light Schema
     */
    default void removeAllLightSchemas() {
        // 默认无操作
    }

    /**
     * 清空指定 datasourceId 的所有 Light Schema。
     */
    default void removeAllLightSchemas(String datasourceId) {
        removeAllLightSchemas();
    }

    /**
     * 删除指定 datasourceId 下、指定表名集合的 Light Schema。
     */
    default void removeLightSchemas(String datasourceId, Collection<String> tableNames) {
        // 默认无操作
    }

    /**
     * 获取 Light Schema 的 ContentRetriever，可按 datasourceId 过滤。
     */
    default ContentRetriever getLightSchemaContentRetriever(String datasourceId) {
        throw new UnsupportedOperationException("Light Schema retriever not supported in this implementation");
    }

    // ---------------数据库单元格向量化-------------------

    /**
     * 添加数据库单元格值（用于字面量模糊匹配）
     *
     * @param tableName 表名
     * @param columnName 列名
     * @param values 单元格值列表
     */
    default void addCells(String tableName, String columnName, List<String> values) {
        throw new UnsupportedOperationException("Cell vectorization not supported in this implementation");
    }

    /**
     * 添加数据库单元格值，写入指定 datasourceId 元数据用于多数据源隔离。
     */
    default void addCells(String datasourceId, String tableName, String columnName, List<String> values) {
        addCells(tableName, columnName, values);
    }

    /**
     * 检索匹配的单元格值
     *
     * @param literal 要匹配的字面量
     * @param topK 返回前 K 个匹配结果
     * @return 匹配的单元格列表
     */
    default List<CellMatch> retrieveCells(String literal, int topK) {
        return Collections.emptyList();
    }

    /**
     * 检索匹配的单元格值，按 datasourceId 过滤。
     */
    default List<CellMatch> retrieveCells(String datasourceId, String literal, int topK) {
        return retrieveCells(literal, topK);
    }

    /**
     * 清空所有单元格数据
     */
    default void removeAllCells() {
        // 默认无操作
    }

    /**
     * 清空指定 datasourceId 的所有单元格数据。
     */
    default void removeAllCells(String datasourceId) {
        removeAllCells();
    }

    /**
     * 删除指定 datasourceId 下、指定表名集合的单元格数据。
     */
    default void removeCells(String datasourceId, Collection<String> tableNames) {
        // 默认无操作
    }

    /**
     * 列出指定 datasourceId 下已被向量化过单元格的 distinct 表名集合。
     * 用于前端展示"已向量化"状态。
     */
    default List<String> cellTables(String datasourceId) {
        return Collections.emptyList();
    }

    /**
     * 获取 Cell 的 ContentRetriever，可按 datasourceId 过滤。
     */
    default ContentRetriever getCellContentRetriever(String datasourceId) {
        throw new UnsupportedOperationException("Cell retriever not supported in this implementation");
    }

    // ---------------Remove All-------------------

    default void removeAll() {
        removeAllSqls();
        removeAllSyns();
        removeAllDocs();
        removeAllLightSchemas();
        removeAllCells();
    }

    // ---------------Index Entries (指标库向量召回)-------------------

    /**
     * 批量写入指标库条目到向量存储,按 {@code projectId} 元数据隔离。
     * <p>嵌入文本通常用 {@code "{standardName} ({aliases ; 分隔})"};Metadata 写入
     * {@code projectId / indexNumber / source / frequency},检索时用 projectId 过滤。
     *
     * <p>默认实现抛 {@link UnsupportedOperationException}。仅在 {@code DefaultContentStore}
     * 注入了 {@code indexEntryEmbeddingStore} 时可用(项目级开启指标问数后才需要)。
     */
    default List<String> addIndexEntries(String projectId, List<IndexEntry> entries) {
        throw new UnsupportedOperationException("Index entry store not supported in this implementation");
    }

    /**
     * 按问题向量召回候选指标(项目内隔离),返回 top-K。
     * <p>未启用时返回空列表(降级,不抛异常)。
     */
    default List<IndexEntry> retrieveIndexEntries(String projectId, String question, int topK) {
        return Collections.emptyList();
    }

    /**
     * 带口径 filter 的向量召回。
     * @param caliberSource 1=人行口径, 2=银监口径, 3=省联社口径; null=不限制
     */
    default List<IndexEntry> retrieveIndexEntries(String projectId, String question, int topK,
                                                   Integer caliberSource) {
        return retrieveIndexEntries(projectId, question, topK);
    }

    /** 清空项目内全部指标条目向量。 */
    default void removeAllIndexEntries(String projectId) {
        // 默认无操作
    }

    /** 按 indexNumber 集合精确删除项目内的指标条目向量。 */
    default void removeIndexEntries(String projectId, Collection<String> indexNumbers) {
        // 默认无操作
    }

    /**
     * Cross-encoder 相关性打分（用于指标候选 rerank）。
     * @return 分数，越高越相关。未配置 scoringModel 时返回 0.0。
     */
    default double scoreRelevance(String query, String document) {
        return 0.0;
    }
}

