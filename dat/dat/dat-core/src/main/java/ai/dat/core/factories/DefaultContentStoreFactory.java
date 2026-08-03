package ai.dat.core.factories;

import ai.dat.core.configuration.ConfigOption;
import ai.dat.core.configuration.ConfigOptions;
import ai.dat.core.configuration.ReadableConfig;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.DefaultContentStore;
import ai.dat.core.contentstore.data.BusinessKnowledgeIndexingMethod;
import ai.dat.core.contentstore.data.BusinessKnowledgeIndexingParentMode;
import ai.dat.core.factories.data.ChatModelInstance;
import ai.dat.core.scoring.LlmScoringModel;
import ai.dat.core.utils.FactoryUtil;
import com.google.common.base.Preconditions;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.scoring.ScoringModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;

import java.util.*;
import java.util.stream.Collectors;

/**
 * @Author JunjieM
 * @Date 2025/7/11
 */
@Slf4j
public class DefaultContentStoreFactory implements ContentStoreFactory {

    public static final String IDENTIFIER = "default";

    public static final ConfigOption<Integer> MAX_RESULTS =
            ConfigOptions.key("max-results")
                    .intType()
                    .defaultValue(5)
                    .withDescription("Content store retrieve TopK maximum value, must be between 1 and 200");

    public static final ConfigOption<Double> MIN_SCORE =
            ConfigOptions.key("min-score")
                    .doubleType()
                    .defaultValue(0.6)
                    .withDescription("Content store retrieve Score minimum value, must be between 0.0 and 1.0");

    public static final ConfigOption<String> DEFAULT_LLM =
            ConfigOptions.key("default-llm")
                    .stringType()
                    .defaultValue("default")
                    .withDescription("Specify the default LLM model name.");

    public static final ConfigOption<Boolean> RERANK_MODE =
            ConfigOptions.key("rerank-mode")
                    .booleanType()
                    .defaultValue(false)
                    .withDescription("Rerank model will reorder the candidate content list based on " +
                            "the semantic match with user query, improving the results of semantic ranking.");

    public static final ConfigOption<Integer> RERANK_MAX_RESULTS =
            ConfigOptions.key("rerank-max-results")
                    .intType()
                    .defaultValue(4)
                    .withDescription("Content store re-rank TopK maximum value, must be between 1 and max-results, " +
                            "and maximum not exceed 20");

    public static final ConfigOption<Double> RERANK_MIN_SCORE =
            ConfigOptions.key("rerank-min-score")
                    .doubleType()
                    .noDefaultValue()
                    .withDescription("Content store re-rank Score minimum value");

    public static final ConfigOption<Boolean> USE_LLM_RERANKING =
            ConfigOptions.key("use-llm-reranking")
                    .booleanType()
                    .defaultValue(false)
                    .withDescription("Reranking using LLM will not use the scoring (reranking) model once enabled.");

    public static final ConfigOption<String> RERANKING_LLM =
            ConfigOptions.key("reranking-llm")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("The name of the LLM model when reranking using LLM. " +
                            "If not set, use the default-llm. (Note: score range [0, 10])");


    // -------------------------------------------- Business Knowledge ---------------------------------------------
    public static final ConfigOption<BusinessKnowledgeIndexingMethod> BUSINESS_KNOWLEDGE_INDEXING_METHOD =
            ConfigOptions.key("business-knowledge.indexing-method")
                    .enumType(BusinessKnowledgeIndexingMethod.class)
                    .defaultValue(BusinessKnowledgeIndexingMethod.PCCE)
                    .withDescription("Business knowledge indexing method.\n" +
                            Arrays.stream(BusinessKnowledgeIndexingMethod.values())
                                    .map(e -> e.name() + ": " + e.getDescription())
                                    .collect(Collectors.joining("\n")));

    public static final ConfigOption<Integer> BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_SIZE =
            ConfigOptions.key("business-knowledge.indexing.gce-max-chunk-size")
                    .intType()
                    .defaultValue(512)
                    .withDescription("Business knowledge `GCE` indexing method maximum chunk length.");

    public static final ConfigOption<Integer> BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_OVERLAP =
            ConfigOptions.key("business-knowledge.indexing.gce-max-chunk-overlap")
                    .intType()
                    .defaultValue(0)
                    .withDescription("Business knowledge `GCE` indexing method maximum chunk overlap length.");

    public static final ConfigOption<String> BUSINESS_KNOWLEDGE_INDEXING_GCE_CHUNK_REGEX =
            ConfigOptions.key("business-knowledge.indexing.gce-chunk-regex")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Business knowledge `GCE` indexing method split chunk regular expression. " +
                            "When it is empty, use the default built-in recursive split method.");

    public static final ConfigOption<BusinessKnowledgeIndexingParentMode> BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MODE =
            ConfigOptions.key("business-knowledge.indexing.pcce-parent-mode")
                    .enumType(BusinessKnowledgeIndexingParentMode.class)
                    .defaultValue(BusinessKnowledgeIndexingParentMode.FULLTEXT)
                    .withDescription("Business knowledge `PCCE` indexing method parent chunk mode.\n" +
                            Arrays.stream(BusinessKnowledgeIndexingParentMode.values())
                                    .map(e -> e.name() + ": " + e.getDescription())
                                    .collect(Collectors.joining("\n")));

    public static final ConfigOption<Integer> BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MAX_CHUNK_SIZE =
            ConfigOptions.key("business-knowledge.indexing.pcce-parent-max-chunk-size")
                    .intType()
                    .defaultValue(1024)
                    .withDescription("Business knowledge `PCCE` indexing method parent maximum chunk length.");

    public static final ConfigOption<String> BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_CHUNK_REGEX =
            ConfigOptions.key("business-knowledge.indexing.pcce-parent-chunk-regex")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Business knowledge `PCCE` indexing method split parent chunk regular expression. " +
                            "When it is empty, use the default built-in recursive split method.");

    public static final ConfigOption<Integer> BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_MAX_CHUNK_SIZE =
            ConfigOptions.key("business-knowledge.indexing.pcce-child-max-chunk-size")
                    .intType()
                    .defaultValue(512)
                    .withDescription("Business knowledge `PCCE` indexing method child maximum chunk length.");

    public static final ConfigOption<String> BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_CHUNK_REGEX =
            ConfigOptions.key("business-knowledge.indexing.pcce-child-chunk-regex")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Business knowledge `PCCE` indexing method split child chunk regular expression. " +
                            "When it is empty, use the default built-in recursive split method.");

    public static final ConfigOption<Integer> BUSINESS_KNOWLEDGE_RETRIEVAL_MAX_RESULTS =
            ConfigOptions.key("business-knowledge.retrieval.max-results")
                    .intType()
                    .noDefaultValue()
                    .withDescription("Business knowledge retrieve TopK maximum value, must be between 1 and 200. " +
                            "If not set, use the max-results.");

    public static final ConfigOption<Double> BUSINESS_KNOWLEDGE_RETRIEVAL_MIN_SCORE =
            ConfigOptions.key("business-knowledge.retrieval.min-score")
                    .doubleType()
                    .noDefaultValue()
                    .withDescription("Business knowledge retrieve Score minimum value, must be between 0.0 and 1.0. " +
                            "If not set, use the min-score.");

    public static final ConfigOption<Integer> SYNONYM_RETRIEVAL_MAX_RESULTS =
            ConfigOptions.key("synonym.retrieval.max-results")
                    .intType()
                    .noDefaultValue()
                    .withDescription("Synonym retrieve TopK maximum value, must be between 1 and 200. " +
                            "If not set, use the max-results.");

    public static final ConfigOption<Double> SYNONYM_RETRIEVAL_MIN_SCORE =
            ConfigOptions.key("synonym.retrieval.min-score")
                    .doubleType()
                    .noDefaultValue()
                    .withDescription("Synonym retrieve Score minimum value, must be between 0.0 and 1.0. " +
                            "If not set, use the min-score. Synonyms are usually short words matched against full questions, " +
                            "so a lower threshold than the global min-score is recommended (e.g. 0.4).");
    // -------------------------------------------------------------------------------------------------------------


    private static final String DEPRECATION_WARNING = "'{}' is deprecated, recommended use '{}'.";
    private static final String ERROR_MESSAGE_FORMAT = "'%s' value must be one of [%s]";

    @Override
    public String factoryIdentifier() {
        return IDENTIFIER;
    }

    @Override
    public Set<ConfigOption<?>> requiredOptions() {
        return Collections.emptySet();
    }

    @Override
    public Set<ConfigOption<?>> optionalOptions() {
        return new LinkedHashSet<>(List.of(
                MAX_RESULTS, MIN_SCORE, DEFAULT_LLM,
                RERANK_MODE, RERANK_MAX_RESULTS, RERANK_MIN_SCORE,
                USE_LLM_RERANKING, RERANKING_LLM,
 
                BUSINESS_KNOWLEDGE_INDEXING_METHOD,
                BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_SIZE,
                BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_OVERLAP,
                BUSINESS_KNOWLEDGE_INDEXING_GCE_CHUNK_REGEX,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MODE,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MAX_CHUNK_SIZE,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_CHUNK_REGEX,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_MAX_CHUNK_SIZE,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_CHUNK_REGEX,
                BUSINESS_KNOWLEDGE_RETRIEVAL_MAX_RESULTS,
                BUSINESS_KNOWLEDGE_RETRIEVAL_MIN_SCORE,
                SYNONYM_RETRIEVAL_MAX_RESULTS,
                SYNONYM_RETRIEVAL_MIN_SCORE
        ));
    }

    @Override
    public Set<ConfigOption<?>> fingerprintOptions() {
        return Set.of(
                BUSINESS_KNOWLEDGE_INDEXING_METHOD,
                BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_SIZE,
                BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_OVERLAP,
                BUSINESS_KNOWLEDGE_INDEXING_GCE_CHUNK_REGEX,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MODE,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MAX_CHUNK_SIZE,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_CHUNK_REGEX,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_MAX_CHUNK_SIZE,
                BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_CHUNK_REGEX
        );
    }

    @Override
    public ContentStore create(@NonNull ReadableConfig config,
                               @NonNull EmbeddingModel embeddingModel,
                               @NonNull EmbeddingStore<TextSegment> sqlEmbeddingStore,
                               @NonNull EmbeddingStore<TextSegment> synEmbeddingStore,
                               @NonNull EmbeddingStore<TextSegment> docEmbeddingStore,
                               EmbeddingStore<TextSegment> lightSchemaEmbeddingStore,
                               EmbeddingStore<TextSegment> cellEmbeddingStore,
                               EmbeddingStore<TextSegment> indexEntryEmbeddingStore,
                               @NonNull List<ChatModelInstance> chatModelInstances,
                               ScoringModel scoringModel) {
        Preconditions.checkArgument(!chatModelInstances.isEmpty(),
                "chatModelInstances cannot be empty");
        FactoryUtil.validateFactoryOptions(this, config);
        Map<String, ChatModelInstance> instances = chatModelInstances.stream()
                .collect(Collectors.toMap(ChatModelInstance::getName, i -> i));
        validateConfigOptions(config, instances, scoringModel);

        ChatModelInstance defaultInstance = config.getOptional(DEFAULT_LLM)
                .map(instances::get).orElseGet(() -> chatModelInstances.get(0));

        BusinessKnowledgeIndexingMethod businessKnowledgeIndexingMethod =
                config.get(BUSINESS_KNOWLEDGE_INDEXING_METHOD);

        DefaultContentStore.DefaultContentStoreBuilder builder = DefaultContentStore.builder()
                .embeddingModel(embeddingModel)
                .sqlEmbeddingStore(sqlEmbeddingStore)
                .synEmbeddingStore(synEmbeddingStore)
                .docEmbeddingStore(docEmbeddingStore)
                .lightSchemaEmbeddingStore(lightSchemaEmbeddingStore)
                .cellEmbeddingStore(cellEmbeddingStore)
                .indexEntryEmbeddingStore(indexEntryEmbeddingStore)
                .defaultChatModel(defaultInstance.getChatModel())
                .docIndexingMethod(businessKnowledgeIndexingMethod);


        config.getOptional(MAX_RESULTS).ifPresent(builder::maxResults);
        config.getOptional(MIN_SCORE).ifPresent(builder::minScore);

        Optional.ofNullable(scoringModel).ifPresent(builder::scoringModel);
        config.getOptional(RERANK_MODE).ifPresent(builder::rerankMode);
        config.getOptional(RERANK_MAX_RESULTS).ifPresent(builder::rerankMaxResults);
        config.getOptional(RERANK_MIN_SCORE).ifPresent(builder::rerankMinScore);
        if (config.get(RERANK_MODE) && config.get(USE_LLM_RERANKING)) {
            ChatModel rerankingChatModel = config.getOptional(RERANKING_LLM)
                    .map(instances::get).orElse(defaultInstance).getChatModel();
            builder.scoringModel(LlmScoringModel.builder()
                    .chatModel(rerankingChatModel)
                    .build());
        }


        if (BusinessKnowledgeIndexingMethod.GCE == businessKnowledgeIndexingMethod) {
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_SIZE).ifPresent(builder::docGCEMaxChunkSize);
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_OVERLAP).ifPresent(builder::docGCEMaxChunkOverlap);
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_GCE_CHUNK_REGEX).ifPresent(builder::docGCEChunkRegex);
        } else if (BusinessKnowledgeIndexingMethod.PCCE == businessKnowledgeIndexingMethod) {
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MODE).ifPresent(builder::docPCCEParentMode);
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MAX_CHUNK_SIZE).ifPresent(builder::docPCCEParentMaxChunkSize);
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_CHUNK_REGEX).ifPresent(builder::docPCCEParentChunkRegex);
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_MAX_CHUNK_SIZE).ifPresent(builder::docPCCEChildMaxChunkSize);
            config.getOptional(BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_CHUNK_REGEX).ifPresent(builder::docPCCEChildChunkRegex);
        }
        config.getOptional(BUSINESS_KNOWLEDGE_RETRIEVAL_MAX_RESULTS).ifPresent(builder::docMaxResults);
        config.getOptional(BUSINESS_KNOWLEDGE_RETRIEVAL_MIN_SCORE).ifPresent(builder::docMinScore);
        config.getOptional(SYNONYM_RETRIEVAL_MAX_RESULTS).ifPresent(builder::synMaxResults);
        config.getOptional(SYNONYM_RETRIEVAL_MIN_SCORE).ifPresent(builder::synMinScore);

        return builder.build();
    }

    private void validateConfigOptions(ReadableConfig config,
                                       Map<String, ChatModelInstance> instances,
                                       ScoringModel scoringModel) {
        Integer maxResults = config.get(MAX_RESULTS);
        Preconditions.checkArgument(maxResults >= 1 && maxResults <= 200,
                "'" + MAX_RESULTS.key() + "' value must be between 1 and 200");
        Double minScore = config.get(MIN_SCORE);
        Preconditions.checkArgument(minScore >= 0.0 && minScore <= 1.0,
                "'" + MIN_SCORE.key() + "' value must be between 0.0 and 1.0");

        Boolean rerankMode = config.get(RERANK_MODE);
        Boolean useLlmReranking = config.get(USE_LLM_RERANKING);
        Preconditions.checkArgument(!rerankMode || useLlmReranking || scoringModel != null,
                "'" + RERANK_MODE.key() + "' is true and '" + USE_LLM_RERANKING.key() + "' is false, " +
                        "reranking has not been set yet");

        Integer rerankMaxResults = config.get(RERANK_MAX_RESULTS);
        int rerankMaxResultsUpperLimit = Math.min(maxResults, 20);
        Preconditions.checkArgument(rerankMaxResults >= 1 && rerankMaxResults <= rerankMaxResultsUpperLimit,
                "'" + RERANK_MAX_RESULTS.key() + "' value must be between 1 and " + rerankMaxResultsUpperLimit);

        String llmNames = String.join(", ", instances.keySet());
        config.getOptional(DEFAULT_LLM)
                .ifPresent(n -> Preconditions.checkArgument(instances.containsKey(n),
                        String.format(ERROR_MESSAGE_FORMAT, DEFAULT_LLM.key(), llmNames)));
        config.getOptional(RERANKING_LLM)
                .ifPresent(n -> Preconditions.checkArgument(instances.containsKey(n),
                        String.format(ERROR_MESSAGE_FORMAT, RERANKING_LLM.key(), llmNames)));


        Integer businessKnowledgeGCEMaxChunkSize = config.get(BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_SIZE);
        Integer businessKnowledgeGCEMaxChunkOverlap = config.get(BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_OVERLAP);
        Preconditions.checkArgument(businessKnowledgeGCEMaxChunkSize > 0,
                "'" + BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_SIZE.key() + "' value must be greater than 0");
        Preconditions.checkArgument(businessKnowledgeGCEMaxChunkOverlap >= 0,
                "'" + BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_OVERLAP.key() + "' value must be greater than or equal to 0");
        Preconditions.checkArgument(businessKnowledgeGCEMaxChunkSize > businessKnowledgeGCEMaxChunkOverlap,
                "'" + BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_OVERLAP.key() + "' value must be less than '"
                        + BUSINESS_KNOWLEDGE_INDEXING_GCE_MAX_CHUNK_SIZE.key() + "' value");
        Integer businessKnowledgePCCEParentMaxChunkSize = config.get(BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MAX_CHUNK_SIZE);
        Integer businessKnowledgePCCEChildMaxChunkSize = config.get(BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_MAX_CHUNK_SIZE);
        Preconditions.checkArgument(businessKnowledgePCCEParentMaxChunkSize > 0,
                "'" + BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MAX_CHUNK_SIZE.key() + "' value must be greater than 0");
        Preconditions.checkArgument(businessKnowledgePCCEChildMaxChunkSize > 0,
                "'" + BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_MAX_CHUNK_SIZE.key() + "' value must be greater than 0");
        Preconditions.checkArgument(businessKnowledgePCCEParentMaxChunkSize > businessKnowledgePCCEChildMaxChunkSize,
                "'" + BUSINESS_KNOWLEDGE_INDEXING_PCCE_CHILD_MAX_CHUNK_SIZE.key() + "' value must be less than '"
                        + BUSINESS_KNOWLEDGE_INDEXING_PCCE_PARENT_MAX_CHUNK_SIZE.key() + "' value");
        config.getOptional(BUSINESS_KNOWLEDGE_RETRIEVAL_MAX_RESULTS)
                .ifPresent(n -> Preconditions.checkArgument(n >= 1 && n <= 200,
                        "'" + BUSINESS_KNOWLEDGE_RETRIEVAL_MAX_RESULTS.key() + "' value must be between 1 and 200"));
        config.getOptional(BUSINESS_KNOWLEDGE_RETRIEVAL_MIN_SCORE)
                .ifPresent(n -> Preconditions.checkArgument(n >= 0.0 && n <= 1.0,
                        "'" + BUSINESS_KNOWLEDGE_RETRIEVAL_MIN_SCORE.key() + "' value must be between 0.0 and 1.0"));
        config.getOptional(SYNONYM_RETRIEVAL_MAX_RESULTS)
                .ifPresent(n -> Preconditions.checkArgument(n >= 1 && n <= 200,
                        "'" + SYNONYM_RETRIEVAL_MAX_RESULTS.key() + "' value must be between 1 and 200"));
        config.getOptional(SYNONYM_RETRIEVAL_MIN_SCORE)
                .ifPresent(n -> Preconditions.checkArgument(n >= 0.0 && n <= 1.0,
                        "'" + SYNONYM_RETRIEVAL_MIN_SCORE.key() + "' value must be between 0.0 and 1.0"));

    }
}
