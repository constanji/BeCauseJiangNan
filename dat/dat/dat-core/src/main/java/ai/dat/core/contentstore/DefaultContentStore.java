package ai.dat.core.contentstore;

import ai.dat.core.contentstore.data.*;
import ai.dat.core.contentstore.utils.ContentStoreUtil;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.base.Preconditions;
import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.DocumentSplitter;
import dev.langchain4j.data.document.Metadata;
import dev.langchain4j.data.document.splitter.DocumentByRegexSplitter;
import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.scoring.ScoringModel;
import dev.langchain4j.rag.content.Content;
import dev.langchain4j.rag.content.aggregator.ContentAggregator;
import dev.langchain4j.rag.content.aggregator.DefaultContentAggregator;
import dev.langchain4j.rag.content.aggregator.ReRankingContentAggregator;
import dev.langchain4j.rag.content.retriever.ContentRetriever;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.rag.query.Query;
import dev.langchain4j.store.embedding.EmbeddingMatch;
import dev.langchain4j.store.embedding.EmbeddingSearchRequest;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.filter.Filter;
import dev.langchain4j.store.embedding.filter.comparison.IsEqualTo;
import dev.langchain4j.store.embedding.filter.comparison.IsIn;
import dev.langchain4j.store.embedding.filter.logical.And;
import lombok.Builder;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 默认实现的内存存储器类
 *
 * @Author JunjieM
 * @Date 2025/6/25
 */
@Slf4j
public class DefaultContentStore implements ContentStore {

    public static final String METADATA_CONTENT_TYPE = "content_type";
    public static final String METADATA_TABLE_NAME = "table_name";
    public static final String METADATA_COLUMN_NAME = "column_name";
    public static final String METADATA_DATASOURCE_ID = "datasource_id";
    public static final String METADATA_PROJECT_ID = "project_id";
    public static final String METADATA_INDEX_NUMBER = "index_number";
    public static final String METADATA_INDEX_SOURCE = "index_source";
    public static final String METADATA_INDEX_FREQUENCY = "index_frequency";

    private static final Metadata SQL_METADATA = Metadata.from(METADATA_CONTENT_TYPE, ContentType.SQL.toString());
    private static final Metadata SYN_METADATA = Metadata.from(METADATA_CONTENT_TYPE, ContentType.SYN.toString());
    private static final Metadata DOC_METADATA = Metadata.from(METADATA_CONTENT_TYPE, ContentType.DOC.toString());
    private static final Metadata LIGHT_SCHEMA_METADATA = Metadata.from(METADATA_CONTENT_TYPE, ContentType.LIGHT_SCHEMA.toString());
    private static final Metadata CELL_METADATA = Metadata.from(METADATA_CONTENT_TYPE, ContentType.CELL.toString());
    private static final Metadata INDEX_ENTRY_METADATA = Metadata.from(METADATA_CONTENT_TYPE, ContentType.INDEX_ENTRY.toString());

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private final EmbeddingModel embeddingModel;

    private final EmbeddingStore<TextSegment> sqlEmbeddingStore;
    private final EmbeddingStore<TextSegment> synEmbeddingStore;
    private final EmbeddingStore<TextSegment> docEmbeddingStore;
    
    // Light Schema 和 Cell 存储（可选）
    private final EmbeddingStore<TextSegment> lightSchemaEmbeddingStore;
    private final EmbeddingStore<TextSegment> cellEmbeddingStore;

    /**
     * 指标库向量存储(可选)。
     * <p>仅当项目开启指标问数模式 (index-ask=true) 时由配置注入,否则为 null,
     * {@link #addIndexEntries(String, List)} 等方法在 null 时按 {@link UnsupportedOperationException}
     * 或空降级处理,与 {@code lightSchemaEmbeddingStore} 一致。
     */
    private final EmbeddingStore<TextSegment> indexEntryEmbeddingStore;

    private final ChatModel defaultChatModel;

    private final Integer maxResults;
    private final Double minScore;

    private final ScoringModel scoringModel;

    private final Boolean rerankMode;
    private final Integer rerankMaxResults;
    private final Double rerankMinScore;

    // -------------------------------------------- Business Knowledge ---------------------------------------------
    private final BusinessKnowledgeIndexingMethod docIndexingMethod;

    private final Integer docGCEMaxChunkSize;
    private final Integer docGCEMaxChunkOverlap;
    private final String docGCEChunkRegex;

    private final BusinessKnowledgeIndexingParentMode docPCCEParentMode;
    private final Integer docPCCEParentMaxChunkSize;
    private final String docPCCEParentChunkRegex;
    private final Integer docPCCEChildMaxChunkSize;
    private final String docPCCEChildChunkRegex;

    private final Integer docMaxResults;
    private final Double docMinScore;

    // 同义词独立检索参数：短词与长问题做向量匹配时阈值应更宽松
    private final Integer synMaxResults;
    private final Double synMinScore;
    // -------------------------------------------------------------------------------------------------------------


    /**
     * 当前 ContentStore 绑定的 datasourceId。
     * - 为 null 表示未绑定（文件模式 / 跨数据源工具）：无差别行为，等同旧实现。
     * - 非 null 表示绑定到某个数据源：所有 LightSchema / Cell 的写入、检索、删除自动按
     *   datasource_id 元数据过滤，实现项目内多数据源之间的隔离。
     */
    @Getter
    @Setter
    private String currentDatasourceId;

    /**
     * "列出全部"操作不关心相似度，只是 langchain4j 的 EmbeddingSearchRequest 强制要求 queryEmbedding。
     * 缓存一份 dummy 向量，避免每次 list 调用都重新走 embedding 模型（本地 50–200ms / 远端 200–800ms）。
     */
    private volatile Embedding listQueryEmbedding;

    /**
     * LightSchema 缓存（按 datasourceId 索引）。
     * Mongo 是权威存储；ProjectService 启动时把 Mongo 里的 schemas 通过 addLightSchemas 灌入 ContentStore，
     * 同时填充这层缓存。后续 agent 调用 allLightSchemas() 直接命中缓存，避免每次问数都对向量库做全表扫
     * (maxResults=Integer.MAX_VALUE) —— 该全表扫单次 1-3s。
     *
     * key = datasourceId（null 用空字符串占位），value = 不可变快照。
     * 任何写入/删除 LightSchema 的入口都会失效对应 key 的缓存。
     */
    private final java.util.concurrent.ConcurrentHashMap<String, List<LightSchema>> lightSchemasCache =
            new java.util.concurrent.ConcurrentHashMap<>();

    private static String cacheKey(String datasourceId) {
        return datasourceId == null ? "" : datasourceId;
    }

    private Embedding listQueryEmbedding() {
        Embedding cached = listQueryEmbedding;
        if (cached == null) {
            synchronized (this) {
                cached = listQueryEmbedding;
                if (cached == null) {
                    cached = embeddingModel.embed("N/A").content();
                    listQueryEmbedding = cached;
                }
            }
        }
        return cached;
    }

    @Builder
    public DefaultContentStore(@NonNull EmbeddingModel embeddingModel,
                               @NonNull EmbeddingStore<TextSegment> sqlEmbeddingStore,
                               @NonNull EmbeddingStore<TextSegment> synEmbeddingStore,
                               @NonNull EmbeddingStore<TextSegment> docEmbeddingStore,
                               EmbeddingStore<TextSegment> lightSchemaEmbeddingStore,
                               EmbeddingStore<TextSegment> cellEmbeddingStore,
                               EmbeddingStore<TextSegment> indexEntryEmbeddingStore,
                               @NonNull ChatModel defaultChatModel,
                               Integer maxResults, Double minScore,
                               ScoringModel scoringModel, Boolean rerankMode,
                               Integer rerankMaxResults, Double rerankMinScore,

                               BusinessKnowledgeIndexingMethod docIndexingMethod,
                               Integer docGCEMaxChunkSize, Integer docGCEMaxChunkOverlap,
                               String docGCEChunkRegex,
                               BusinessKnowledgeIndexingParentMode docPCCEParentMode,
                               Integer docPCCEParentMaxChunkSize, String docPCCEParentChunkRegex,
                               Integer docPCCEChildMaxChunkSize, String docPCCEChildChunkRegex,
                               Integer docMaxResults, Double docMinScore,

                               Integer synMaxResults, Double synMinScore) {
        this.defaultChatModel = defaultChatModel;
        this.embeddingModel = embeddingModel;
        this.sqlEmbeddingStore = sqlEmbeddingStore;
        this.synEmbeddingStore = synEmbeddingStore;
        this.docEmbeddingStore = docEmbeddingStore;
        this.lightSchemaEmbeddingStore = lightSchemaEmbeddingStore;
        this.cellEmbeddingStore = cellEmbeddingStore;
        this.indexEntryEmbeddingStore = indexEntryEmbeddingStore;
        this.maxResults = Optional.ofNullable(maxResults).orElse(5);
        Preconditions.checkArgument(this.maxResults <= 200 && this.maxResults >= 1,
                "maxResults must be between 1 and 200");
        this.minScore = Optional.ofNullable(minScore).orElse(0.6);
        Preconditions.checkArgument(this.minScore >= 0.0 && this.minScore <= 1.0,
                "minScore must be between 0.0 and 1.0");
        this.scoringModel = scoringModel;
        this.rerankMode = Optional.ofNullable(rerankMode).orElse(false);
        Preconditions.checkArgument(!this.rerankMode || this.scoringModel != null,
                "scoringModel cannot be null when rerankMode is true");
        this.rerankMaxResults = Optional.ofNullable(rerankMaxResults).orElse(this.maxResults);
        int rerankMaxResultsUpperLimit = Math.min(this.maxResults, 20);
        Preconditions.checkArgument(this.rerankMaxResults <= rerankMaxResultsUpperLimit
                        && this.rerankMaxResults >= 1,
                "rerankMaxResults must be between 1 and %s", rerankMaxResultsUpperLimit);
        this.rerankMinScore = rerankMinScore;


        // -------------------------------------------- Business Knowledge -------------------------------------
        this.docIndexingMethod = Optional.ofNullable(docIndexingMethod)
                .orElse(BusinessKnowledgeIndexingMethod.PCCE);

        this.docGCEMaxChunkSize = Optional.ofNullable(docGCEMaxChunkSize).orElse(512);
        Preconditions.checkArgument(this.docGCEMaxChunkSize > 0,
                "docGCEMaxChunkSize must be greater than 0");
        this.docGCEMaxChunkOverlap = Optional.ofNullable(docGCEMaxChunkOverlap).orElse(0);
        Preconditions.checkArgument(this.docGCEMaxChunkOverlap >= 0,
                "docGCEMaxChunkOverlap must be greater than than or equal to 0");
        Preconditions.checkArgument(this.docGCEMaxChunkSize > this.docGCEMaxChunkOverlap,
                "docGCEMaxChunkOverlap value must be less than docGCEMaxChunkSize value");
        this.docGCEChunkRegex = docGCEChunkRegex;

        this.docPCCEParentMode = Optional.ofNullable(docPCCEParentMode)
                .orElse(BusinessKnowledgeIndexingParentMode.FULLTEXT);
        this.docPCCEParentMaxChunkSize = Optional.ofNullable(docPCCEParentMaxChunkSize).orElse(1024);
        Preconditions.checkArgument(this.docPCCEParentMaxChunkSize > 0,
                "docPCCEParentMaxChunkSize must be greater than 0");
        this.docPCCEChildMaxChunkSize = Optional.ofNullable(docPCCEChildMaxChunkSize).orElse(512);
        Preconditions.checkArgument(this.docPCCEChildMaxChunkSize > 0,
                "docPCCEChildMaxChunkSize must be greater than 0");
        Preconditions.checkArgument(this.docPCCEParentMaxChunkSize > this.docPCCEChildMaxChunkSize,
                "docPCCEChildMaxChunkSize value must be less than docPCCEParentMaxChunkSize value");
        this.docPCCEParentChunkRegex = docPCCEParentChunkRegex;
        this.docPCCEChildChunkRegex = docPCCEChildChunkRegex;

        this.docMaxResults = Optional.ofNullable(docMaxResults).orElse(this.maxResults);
        Preconditions.checkArgument(this.docMaxResults <= 200 && this.docMaxResults >= 1,
                "docMaxResults must be between 1 and 200");
        this.docMinScore = Optional.ofNullable(docMinScore).orElse(this.minScore);
        Preconditions.checkArgument(this.docMinScore >= 0.0 && this.docMinScore <= 1.0,
                "docMinScore must be between 0.0 and 1.0");

        this.synMaxResults = Optional.ofNullable(synMaxResults).orElse(this.maxResults);
        Preconditions.checkArgument(this.synMaxResults <= 200 && this.synMaxResults >= 1,
                "synMaxResults must be between 1 and 200");
        this.synMinScore = Optional.ofNullable(synMinScore).orElse(this.minScore);
        Preconditions.checkArgument(this.synMinScore >= 0.0 && this.synMinScore <= 1.0,
                "synMinScore must be between 0.0 and 1.0");
        // -----------------------------------------------------------------------------------------------------
    }

    @Override
    public List<String> addSqls(List<QuestionSqlPair> sqlPairs) {
        List<TextSegment> embedTextSegments = sqlPairs.stream()
                .map(QuestionSqlPair::getQuestion)
                .map(TextSegment::from)
                .toList();
        List<Embedding> embeddings = embeddingModel.embedAll(embedTextSegments).content();
        List<TextSegment> textSegments = sqlPairs.stream()
                .map(pair -> {
                    String json;
                    try {
                        json = JSON_MAPPER.writeValueAsString(pair);
                    } catch (JsonProcessingException e) {
                        throw new RuntimeException("Failed to serialize question sql pair to JSON: "
                                + e.getMessage(), e);
                    }
                    return TextSegment.from(json, SQL_METADATA);
                }).collect(Collectors.toList());
        return sqlEmbeddingStore.addAll(embeddings, textSegments);
    }

    @Override
    public ContentRetriever getSqlContentRetriever() {
        return EmbeddingStoreContentRetriever.builder()
                .embeddingModel(embeddingModel)
                .embeddingStore(sqlEmbeddingStore)
                .maxResults(maxResults)
                .minScore(minScore)
                .build();
    }

    @Override
    public ContentAggregator getSqlContentAggregator() {
        if (scoringModel == null) {
            return new DefaultContentAggregator();
        }
        ReRankingContentAggregator.ReRankingContentAggregatorBuilder builder =
                ReRankingContentAggregator.builder()
                        .scoringModel(scoringModel)
                        .maxResults(rerankMaxResults);
        Optional.ofNullable(rerankMinScore).ifPresent(builder::minScore);
        return builder.build();
    }

    @Override
    public List<QuestionSqlPair> retrieveSql(String question) {
        Query query = Query.from(question);
        List<Content> contents = getSqlContentRetriever().retrieve(query);
        if (rerankMode && !contents.isEmpty()) {
            contents = getSqlContentAggregator().aggregate(
                    Collections.singletonMap(query, Collections.singletonList(contents)));
        }
        return ContentStoreUtil.contents2QuestionSqlPairs(contents);
    }

    @Override
    public boolean isSql(TextSegment textSegment) {
        return ContentType.SQL.toString()
                .equals(textSegment.metadata().getString(METADATA_CONTENT_TYPE));
    }

    @Override
    public void removeSqls(Collection<String> ids) {
        sqlEmbeddingStore.removeAll(ids);
    }

    @Override
    public void removeAllSqls() {
        sqlEmbeddingStore.removeAll();
    }

    @Override
    public List<QuestionSqlPair> allSqls() {
        EmbeddingSearchRequest searchRequest = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE)
                .build();
        List<TextSegment> textSegments = sqlEmbeddingStore.search(searchRequest)
                .matches()
                .stream()
                .map(EmbeddingMatch::embedded)
                .collect(Collectors.toList());
        return ContentStoreUtil.toQuestionSqlPairs(textSegments);
    }

    @Override
    public List<QuestionSqlPairWithId> allSqlsWithId() {
        EmbeddingSearchRequest searchRequest = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE)
                .build();
        return sqlEmbeddingStore.search(searchRequest)
                .matches()
                .stream()
                .map(match -> {
                    QuestionSqlPair pair = ContentStoreUtil.toQuestionSqlPair(match.embedded());
                    return QuestionSqlPairWithId.from(match.embeddingId(), pair);
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<String> addSyns(List<WordSynonymPair> synonymPairs) {
        // FIX: 同义词的嵌入文本不能是 JSON，否则用户问题（自然语言）与 JSON 字符串的向量相似度极低，
        // 导致 retrieveSyn 几乎召不回。用 noun + synonyms 拼接成自然文本做 embedding，
        // 存储文本仍用 JSON 以便反序列化恢复 WordSynonymPair。
        List<TextSegment> embedTextSegments = synonymPairs.stream()
                .map(pair -> {
                    StringBuilder sb = new StringBuilder(pair.getWord() == null ? "" : pair.getWord());
                    if (pair.getSynonyms() != null && !pair.getSynonyms().isEmpty()) {
                        sb.append(" ").append(String.join(" ", pair.getSynonyms()));
                    }
                    return TextSegment.from(sb.toString().trim());
                })
                .toList();
        List<Embedding> embeddings = embeddingModel.embedAll(embedTextSegments).content();

        List<TextSegment> storedSegments = synonymPairs.stream()
                .map(pair -> {
                    String json;
                    try {
                        json = JSON_MAPPER.writeValueAsString(pair);
                    } catch (JsonProcessingException e) {
                        throw new RuntimeException("Failed to serialize noun synonyms pair to JSON: "
                                + e.getMessage(), e);
                    }
                    return TextSegment.from(json, SYN_METADATA);
                }).collect(Collectors.toList());
        return synEmbeddingStore.addAll(embeddings, storedSegments);
    }

    @Override
    public ContentRetriever getSynContentRetriever() {
        return EmbeddingStoreContentRetriever.builder()
                .embeddingModel(embeddingModel)
                .embeddingStore(synEmbeddingStore)
                .maxResults(synMaxResults)
                .minScore(synMinScore)
                .build();
    }

    @Override
    public ContentAggregator getSynContentAggregator() {
        if (scoringModel == null) {
            return new DefaultContentAggregator();
        }
        ReRankingContentAggregator.ReRankingContentAggregatorBuilder builder =
                ReRankingContentAggregator.builder()
                        .scoringModel(scoringModel)
                        .maxResults(rerankMaxResults);
        Optional.ofNullable(rerankMinScore).ifPresent(builder::minScore);
        return builder.build();
    }

    @Override
    public List<WordSynonymPair> retrieveSyn(String question) {
        Query query = Query.from(question);
        List<Content> contents = getSynContentRetriever().retrieve(query);
        if (rerankMode && !contents.isEmpty()) {
            contents = getSynContentAggregator().aggregate(
                    Collections.singletonMap(query, Collections.singletonList(contents)));
        }
        return ContentStoreUtil.contents2NounSynonymPairs(contents);
    }

    @Override
    public boolean isSyn(TextSegment textSegment) {
        return ContentType.SYN.toString()
                .equals(textSegment.metadata().getString(METADATA_CONTENT_TYPE));
    }

    @Override
    public void removeSyns(Collection<String> ids) {
        synEmbeddingStore.removeAll(ids);
    }

    @Override
    public void removeAllSyns() {
        synEmbeddingStore.removeAll();
    }

    @Override
    public List<WordSynonymPair> allSyns() {
        EmbeddingSearchRequest searchRequest = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE)
                .build();
        List<TextSegment> textSegments = synEmbeddingStore.search(searchRequest)
                .matches()
                .stream()
                .map(EmbeddingMatch::embedded)
                .collect(Collectors.toList());
        return ContentStoreUtil.toNounSynonymPairs(textSegments);
    }

    @Override
    public List<WordSynonymPairWithId> allSynsWithId() {
        EmbeddingSearchRequest searchRequest = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE)
                .build();
        return synEmbeddingStore.search(searchRequest)
                .matches()
                .stream()
                .map(match -> {
                    WordSynonymPair pair = ContentStoreUtil.toNounSynonymPair(match.embedded());
                    return WordSynonymPairWithId.from(match.embeddingId(), pair);
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<String> addDocs(List<String> docs) {
        if (BusinessKnowledgeIndexingMethod.GCE == docIndexingMethod) {
            return addDocsForGCE(docs);
        } else if (BusinessKnowledgeIndexingMethod.PCCE == docIndexingMethod) {
            return addDocsForPCCE(docs);
        }
        return addDocsForFE(docs);
    }

    private List<String> addDocsForPCCE(List<String> docs) {
        DocumentSplitter parentSplitter = null;
        if (BusinessKnowledgeIndexingParentMode.PARAGRAPH == docPCCEParentMode) {
            parentSplitter = DocumentSplitters.recursive(docPCCEParentMaxChunkSize, 0);
            if (docPCCEParentChunkRegex != null) {
                parentSplitter = new DocumentByRegexSplitter(docPCCEParentChunkRegex, "\n\n",
                        docPCCEParentMaxChunkSize, 0, parentSplitter);
            }
        }
        DocumentSplitter childSplitter = DocumentSplitters.recursive(docPCCEChildMaxChunkSize, 0);
        if (docPCCEChildChunkRegex != null) {
            childSplitter = new DocumentByRegexSplitter(docPCCEChildChunkRegex, "\n",
                    docPCCEChildMaxChunkSize, 0, childSplitter);
        }
        DocumentSplitter finalParentSplitter = parentSplitter;
        DocumentSplitter finalChildSplitter = childSplitter;
        return docs.stream().flatMap(text -> {
            List<String> parentTexts = BusinessKnowledgeIndexingParentMode.PARAGRAPH == docPCCEParentMode ?
                    finalParentSplitter.split(Document.document(text)).stream().map(TextSegment::text).toList() :
                    Collections.singletonList(text);
            return parentTexts.stream().flatMap(parentText -> {
                TextSegment textSegment = TextSegment.from(parentText, DOC_METADATA);
                List<TextSegment> embedTextSegments = finalChildSplitter.split(Document.document(parentText));
                List<Embedding> embeddings = embeddingModel.embedAll(embedTextSegments).content();
                List<TextSegment> textSegments = embeddings.stream().map(o -> textSegment).collect(Collectors.toList());
                return docEmbeddingStore.addAll(embeddings, textSegments).stream();
            });
        }).collect(Collectors.toList());
    }

    private List<String> addDocsForGCE(List<String> docs) {
        DocumentSplitter splitter = DocumentSplitters.recursive(docGCEMaxChunkSize, docGCEMaxChunkOverlap);
        if (docGCEChunkRegex != null) {
            splitter = new DocumentByRegexSplitter(docGCEChunkRegex, "\n",
                    docGCEMaxChunkSize, docGCEMaxChunkOverlap, splitter);
        }
        List<Document> documents = docs.stream().map(doc -> Document.document(doc, DOC_METADATA)).collect(Collectors.toList());
        List<TextSegment> textSegments = splitter.splitAll(documents);
        List<Embedding> embeddings = embeddingModel.embedAll(textSegments).content();
        return docEmbeddingStore.addAll(embeddings, textSegments);
    }

    private List<String> addDocsForFE(List<String> docs) {
        List<TextSegment> textSegments = docs.stream()
                .map(doc -> TextSegment.from(doc, DOC_METADATA))
                .collect(Collectors.toList());
        List<Embedding> embeddings = embeddingModel.embedAll(textSegments).content();
        return docEmbeddingStore.addAll(embeddings, textSegments);
    }

    @Override
    public ContentRetriever getDocContentRetriever() {
        return EmbeddingStoreContentRetriever.builder()
                .embeddingModel(embeddingModel)
                .embeddingStore(docEmbeddingStore)
                .maxResults(docMaxResults)
                .minScore(docMinScore)
                .build();
    }

    @Override
    public ContentAggregator getDocContentAggregator() {
        if (scoringModel == null) {
            return new DefaultContentAggregator();
        }
        ReRankingContentAggregator.ReRankingContentAggregatorBuilder builder =
                ReRankingContentAggregator.builder()
                        .scoringModel(scoringModel)
                        .maxResults(rerankMaxResults);
        Optional.ofNullable(rerankMinScore).ifPresent(builder::minScore);
        return builder.build();
    }

    @Override
    public List<String> retrieveDoc(String question) {
        Query query = Query.from(question);
        List<Content> contents = getDocContentRetriever().retrieve(query);
        if (rerankMode && !contents.isEmpty()) {
            contents = getDocContentAggregator().aggregate(
                    Collections.singletonMap(query, Collections.singletonList(contents)));
        }
        // PCCE 模式下同一父文本会被多个子块召回多次，按文本保序去重
        return ContentStoreUtil.contents2Docs(contents).stream()
                .distinct()
                .collect(Collectors.toList());
    }

    @Override
    public boolean isDoc(TextSegment textSegment) {
        return ContentType.DOC.toString()
                .equals(textSegment.metadata().getString(METADATA_CONTENT_TYPE));
    }

    @Override
    public void removeDocs(Collection<String> ids) {
        docEmbeddingStore.removeAll(ids);
    }

    @Override
    public void removeAllDocs() {
        docEmbeddingStore.removeAll();
    }

    @Override
    public List<String> allDocs() {
        EmbeddingSearchRequest searchRequest = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE)
                .build();
        List<TextSegment> textSegments = docEmbeddingStore.search(searchRequest)
                .matches()
                .stream()
                .map(EmbeddingMatch::embedded)
                .collect(Collectors.toList());
        return ContentStoreUtil.toDocs(textSegments);
    }

    @Override
    public List<DocWithId> allDocsWithId() {
        EmbeddingSearchRequest searchRequest = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE)
                .build();
        return docEmbeddingStore.search(searchRequest)
                .matches()
                .stream()
                .map(match -> DocWithId.from(match.embeddingId(), match.embedded().text()))
                .collect(Collectors.toList());
    }

    // ---------------------------------------- Light Schema ----------------------------------------

    @Override
    public List<String> addLightSchemas(List<LightSchema> schemas) {
        return addLightSchemas(currentDatasourceId, schemas);
    }

    @Override
    public List<String> addLightSchemas(String datasourceId, List<LightSchema> schemas) {
        if (lightSchemaEmbeddingStore == null) {
            throw new UnsupportedOperationException("Light Schema store not configured");
        }
        if (schemas == null || schemas.isEmpty()) {
            return Collections.emptyList();
        }
        List<TextSegment> textSegments = schemas.stream()
                .map(schema -> {
                    String json;
                    try {
                        json = JSON_MAPPER.writeValueAsString(schema);
                    } catch (JsonProcessingException e) {
                        throw new RuntimeException("Failed to serialize LightSchema to JSON: " + e.getMessage(), e);
                    }
                    Metadata metadata = Metadata.from(METADATA_CONTENT_TYPE, ContentType.LIGHT_SCHEMA.toString())
                            .put(METADATA_TABLE_NAME, schema.getTableName() == null ? "" : schema.getTableName());
                    if (datasourceId != null) {
                        metadata.put(METADATA_DATASOURCE_ID, datasourceId);
                    }
                    return TextSegment.from(json, metadata);
                }).collect(Collectors.toList());
        // 使用表名作为嵌入文本
        List<TextSegment> embedTextSegments = schemas.stream()
                .map(schema -> TextSegment.from(schema.getTableName() + ": " + schema.toMarkdown()))
                .toList();
        List<Embedding> embeddings = embeddingModel.embedAll(embedTextSegments).content();
        List<String> ids = lightSchemaEmbeddingStore.addAll(embeddings, textSegments);

        // 写入成功后维护缓存：合并到现有缓存（按 tableName 去重，新值覆盖旧值）。
        // 这样 ProjectService 启动期间从 Mongo 灌入 schemas 后，agent 后续问数可直接命中缓存。
        lightSchemasCache.compute(cacheKey(datasourceId), (k, existing) -> {
            Map<String, LightSchema> merged = new LinkedHashMap<>();
            if (existing != null) {
                for (LightSchema s : existing) {
                    merged.put(s.getTableName(), s);
                }
            }
            for (LightSchema s : schemas) {
                merged.put(s.getTableName(), s);
            }
            return List.copyOf(merged.values());
        });

        return ids;
    }

    @Override
    public List<LightSchema> allLightSchemas() {
        return allLightSchemas(currentDatasourceId);
    }

    @Override
    public List<LightSchema> allLightSchemas(String datasourceId) {
        if (lightSchemaEmbeddingStore == null) {
            return Collections.emptyList();
        }
        // 优先命中缓存：addLightSchemas 已经把 Mongo 灌入的 schemas 同步进缓存。
        // 这条路径完全跳过向量库扫描（原实现 maxResults=Integer.MAX_VALUE 单次 1-3s）。
        List<LightSchema> cached = lightSchemasCache.get(cacheKey(datasourceId));
        if (cached != null) {
            return cached;
        }
        EmbeddingSearchRequest.EmbeddingSearchRequestBuilder builder = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE);
        if (datasourceId != null) {
            builder.filter(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId));
        }
        List<LightSchema> result = lightSchemaEmbeddingStore.search(builder.build())
                .matches()
                .stream()
                .map(EmbeddingMatch::embedded)
                .map(segment -> {
                    try {
                        return JSON_MAPPER.readValue(segment.text(), LightSchema.class);
                    } catch (JsonProcessingException e) {
                        throw new RuntimeException("Failed to deserialize LightSchema: " + e.getMessage(), e);
                    }
                })
                .distinct()
                .collect(Collectors.toList());
        // 回填缓存，下次同 datasourceId 的 list 操作就走快路径。
        lightSchemasCache.put(cacheKey(datasourceId), List.copyOf(result));
        return result;
    }

    @Override
    public void removeAllLightSchemas() {
        removeAllLightSchemas(currentDatasourceId);
    }

    @Override
    public void removeAllLightSchemas(String datasourceId) {
        if (lightSchemaEmbeddingStore == null) {
            return;
        }
        if (datasourceId == null) {
            lightSchemaEmbeddingStore.removeAll();
            lightSchemasCache.clear();
        } else {
            lightSchemaEmbeddingStore.removeAll(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId));
            lightSchemasCache.remove(cacheKey(datasourceId));
        }
    }

    @Override
    public void removeLightSchemas(String datasourceId, Collection<String> tableNames) {
        if (lightSchemaEmbeddingStore == null || tableNames == null || tableNames.isEmpty()) {
            return;
        }
        Filter tableFilter = new IsIn(METADATA_TABLE_NAME, new ArrayList<>(tableNames));
        Filter filter = datasourceId == null
                ? tableFilter
                : new And(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId), tableFilter);
        lightSchemaEmbeddingStore.removeAll(filter);

        // 同步从缓存里剔除被删除的表。
        Set<String> drop = new HashSet<>(tableNames);
        lightSchemasCache.computeIfPresent(cacheKey(datasourceId), (k, existing) ->
                existing.stream()
                        .filter(s -> !drop.contains(s.getTableName()))
                        .collect(Collectors.toUnmodifiableList()));
    }

    @Override
    public ContentRetriever getLightSchemaContentRetriever(String datasourceId) {
        if (lightSchemaEmbeddingStore == null) {
            throw new UnsupportedOperationException("Light Schema store not configured");
        }
        EmbeddingStoreContentRetriever.EmbeddingStoreContentRetrieverBuilder builder =
                EmbeddingStoreContentRetriever.builder()
                        .embeddingModel(embeddingModel)
                        .embeddingStore(lightSchemaEmbeddingStore)
                        .maxResults(maxResults)
                        .minScore(minScore);
        if (datasourceId != null) {
            builder.filter(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId));
        }
        return builder.build();
    }

    // ---------------------------------------- Database Cells ----------------------------------------

    @Override
    public void addCells(String tableName, String columnName, List<String> values) {
        addCells(currentDatasourceId, tableName, columnName, values);
    }

    @Override
    public void addCells(String datasourceId, String tableName, String columnName, List<String> values) {
        if (cellEmbeddingStore == null) {
            throw new UnsupportedOperationException("Cell store not configured");
        }
        if (values == null || values.isEmpty()) {
            return;
        }
        List<TextSegment> textSegments = values.stream()
                .filter(v -> v != null && !v.isBlank())
                .map(value -> {
                    Metadata metadata = Metadata.from(METADATA_CONTENT_TYPE, ContentType.CELL.toString())
                            .put(METADATA_TABLE_NAME, tableName)
                            .put(METADATA_COLUMN_NAME, columnName);
                    if (datasourceId != null) {
                        metadata.put(METADATA_DATASOURCE_ID, datasourceId);
                    }
                    return TextSegment.from(value, metadata);
                })
                .collect(Collectors.toList());
        if (textSegments.isEmpty()) {
            return;
        }
        List<Embedding> embeddings = embeddingModel.embedAll(textSegments).content();
        cellEmbeddingStore.addAll(embeddings, textSegments);
    }

    @Override
    public List<CellMatch> retrieveCells(String literal, int topK) {
        return retrieveCells(currentDatasourceId, literal, topK);
    }

    @Override
    public List<CellMatch> retrieveCells(String datasourceId, String literal, int topK) {
        if (cellEmbeddingStore == null || literal == null || literal.isBlank()) {
            return Collections.emptyList();
        }
        Embedding queryEmbedding = embeddingModel.embed(literal).content();
        EmbeddingSearchRequest.EmbeddingSearchRequestBuilder builder = EmbeddingSearchRequest.builder()
                .queryEmbedding(queryEmbedding)
                .minScore(0.5)  // 使用较低的阈值以获取更多候选
                .maxResults(topK);
        if (datasourceId != null) {
            builder.filter(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId));
        }
        return cellEmbeddingStore.search(builder.build())
                .matches()
                .stream()
                .map(match -> CellMatch.builder()
                        .tableName(match.embedded().metadata().getString(METADATA_TABLE_NAME))
                        .columnName(match.embedded().metadata().getString(METADATA_COLUMN_NAME))
                        .cellValue(match.embedded().text())
                        .score(match.score())
                        .build())
                .collect(Collectors.toList());
    }

    @Override
    public void removeAllCells() {
        removeAllCells(currentDatasourceId);
    }

    @Override
    public void removeAllCells(String datasourceId) {
        if (cellEmbeddingStore == null) {
            return;
        }
        if (datasourceId == null) {
            cellEmbeddingStore.removeAll();
        } else {
            cellEmbeddingStore.removeAll(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId));
        }
    }

    @Override
    public void removeCells(String datasourceId, Collection<String> tableNames) {
        if (cellEmbeddingStore == null || tableNames == null || tableNames.isEmpty()) {
            return;
        }
        Filter tableFilter = new IsIn(METADATA_TABLE_NAME, new ArrayList<>(tableNames));
        Filter filter = datasourceId == null
                ? tableFilter
                : new And(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId), tableFilter);
        cellEmbeddingStore.removeAll(filter);
    }

    @Override
    public List<String> cellTables(String datasourceId) {
        if (cellEmbeddingStore == null) {
            return Collections.emptyList();
        }
        EmbeddingSearchRequest.EmbeddingSearchRequestBuilder builder = EmbeddingSearchRequest.builder()
                .queryEmbedding(listQueryEmbedding())
                .minScore(0.0)
                .maxResults(Integer.MAX_VALUE);
        if (datasourceId != null) {
            builder.filter(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId));
        }
        return cellEmbeddingStore.search(builder.build())
                .matches()
                .stream()
                .map(EmbeddingMatch::embedded)
                .map(seg -> seg.metadata().getString(METADATA_TABLE_NAME))
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());
    }

    @Override
    public ContentRetriever getCellContentRetriever(String datasourceId) {
        if (cellEmbeddingStore == null) {
            throw new UnsupportedOperationException("Cell store not configured");
        }
        EmbeddingStoreContentRetriever.EmbeddingStoreContentRetrieverBuilder builder =
                EmbeddingStoreContentRetriever.builder()
                        .embeddingModel(embeddingModel)
                        .embeddingStore(cellEmbeddingStore)
                        .maxResults(maxResults)
                        .minScore(0.5);
        if (datasourceId != null) {
            builder.filter(new IsEqualTo(METADATA_DATASOURCE_ID, datasourceId));
        }
        return builder.build();
    }

    // ---------------------------------------- Index Entries (指标库向量召回) ----------------------------------------

    @Override
    public List<String> addIndexEntries(String projectId, List<IndexEntry> entries) {
        if (indexEntryEmbeddingStore == null) {
            throw new UnsupportedOperationException("Index entry store not configured");
        }
        if (entries == null || entries.isEmpty()) {
            return Collections.emptyList();
        }
        // 嵌入文本:standardName 主体 + 别名拼接,让向量召回同时覆盖标准名和别名命中
        List<TextSegment> embedTextSegments = entries.stream()
                .map(e -> TextSegment.from(buildEmbedText(e)))
                .toList();
        List<Embedding> embeddings = embeddingModel.embedAll(embedTextSegments).content();
        // 真正落地的 TextSegment:存指标的 JSON,Metadata 写 projectId/indexNumber/source/frequency
        // 检索时按 projectId 过滤,反序列化 JSON 还原 IndexEntry
        List<TextSegment> storedSegments = entries.stream()
                .map(entry -> {
                    String json;
                    try {
                        json = JSON_MAPPER.writeValueAsString(entry);
                    } catch (JsonProcessingException ex) {
                        throw new RuntimeException("Failed to serialize IndexEntry to JSON: "
                                + ex.getMessage(), ex);
                    }
                    Metadata md = Metadata.from(METADATA_CONTENT_TYPE, ContentType.INDEX_ENTRY.toString())
                            .put(METADATA_INDEX_NUMBER, entry.getIndexNumber() == null ? "" : entry.getIndexNumber());
                    if (projectId != null) {
                        md.put(METADATA_PROJECT_ID, projectId);
                    }
                    if (entry.getSource() != null) {
                        md.put(METADATA_INDEX_SOURCE, String.valueOf(entry.getSource()));
                    }
                    if (entry.getFrequency() != null) {
                        md.put(METADATA_INDEX_FREQUENCY, entry.getFrequency());
                    }
                    return TextSegment.from(json, md);
                })
                .collect(Collectors.toList());
        return indexEntryEmbeddingStore.addAll(embeddings, storedSegments);
    }

    @Override
    public List<IndexEntry> retrieveIndexEntries(String projectId, String question, int topK) {
        return retrieveIndexEntries(projectId, question, topK, null);
    }

    @Override
    public List<IndexEntry> retrieveIndexEntries(String projectId, String question, int topK,
                                                  Integer caliberSource) {
        if (indexEntryEmbeddingStore == null || question == null || question.isBlank() || topK <= 0) {
            return Collections.emptyList();
        }
        Embedding queryEmbedding = embeddingModel.embed(question).content();
        EmbeddingSearchRequest.EmbeddingSearchRequestBuilder builder = EmbeddingSearchRequest.builder()
                .queryEmbedding(queryEmbedding)
                .minScore(0.5)
                .maxResults(topK);
        // 构建组合 filter
        List<Filter> filters = new ArrayList<>();
        if (projectId != null) {
            filters.add(new IsEqualTo(METADATA_PROJECT_ID, projectId));
        }
        if (caliberSource != null) {
            filters.add(new IsEqualTo(METADATA_INDEX_SOURCE, String.valueOf(caliberSource)));
        }
        if (!filters.isEmpty()) {
            builder.filter(filters.size() == 1 ? filters.get(0)
                    : new And(
                            filters.get(0), filters.get(1)));
        }
        return indexEntryEmbeddingStore.search(builder.build())
                .matches()
                .stream()
                .map(EmbeddingMatch::embedded)
                .map(seg -> {
                    try {
                        return JSON_MAPPER.readValue(seg.text(), IndexEntry.class);
                    } catch (JsonProcessingException ex) {
                        throw new RuntimeException("Failed to deserialize IndexEntry: " + ex.getMessage(), ex);
                    }
                })
                .collect(Collectors.toList());
    }

    @Override
    public void removeAllIndexEntries(String projectId) {
        if (indexEntryEmbeddingStore == null) {
            return;
        }
        if (projectId == null) {
            indexEntryEmbeddingStore.removeAll();
        } else {
            indexEntryEmbeddingStore.removeAll(new IsEqualTo(METADATA_PROJECT_ID, projectId));
        }
    }

    @Override
    public void removeIndexEntries(String projectId, Collection<String> indexNumbers) {
        if (indexEntryEmbeddingStore == null || indexNumbers == null || indexNumbers.isEmpty()) {
            return;
        }
        Filter numberFilter = new IsIn(METADATA_INDEX_NUMBER, new ArrayList<>(indexNumbers));
        Filter filter = projectId == null
                ? numberFilter
                : new And(new IsEqualTo(METADATA_PROJECT_ID, projectId), numberFilter);
        indexEntryEmbeddingStore.removeAll(filter);
    }

    @Override
    public double scoreRelevance(String query, String document) {
        if (scoringModel == null || query == null || document == null) return 0.0;
        try {
            return scoringModel.score(query, document).content();
        } catch (Exception e) {
            log.warn("scoringModel.score failed: {}", e.getMessage());
            return 0.0;
        }
    }

    /** 嵌入文本格式:"{standardName} ({aliases ; 分隔})";aliases 为空时只用 standardName。 */
    private static String buildEmbedText(IndexEntry entry) {
        StringBuilder sb = new StringBuilder(entry.getStandardName() == null ? "" : entry.getStandardName());
        if (entry.getAliases() != null && !entry.getAliases().isEmpty()) {
            sb.append(" (").append(String.join("; ", entry.getAliases())).append(")");
        }
        return sb.toString();
    }

}
