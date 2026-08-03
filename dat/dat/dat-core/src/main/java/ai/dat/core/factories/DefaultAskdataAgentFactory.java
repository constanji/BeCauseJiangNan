package ai.dat.core.factories;


import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.agent.AskdataAgent;
import ai.dat.core.agent.DefaultAskdataAgent;
import ai.dat.core.configuration.ConfigOption;
import ai.dat.core.configuration.ConfigOptions;
import ai.dat.core.configuration.ReadableConfig;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.factories.data.ChatModelInstance;
import ai.dat.core.utils.FactoryUtil;
import com.google.common.base.Preconditions;
import lombok.NonNull;

import java.util.*;
import java.util.stream.Collectors;

/**
 * @Author JunjieM
 * @Date 2025/6/30
 */
public class DefaultAskdataAgentFactory implements AskdataAgentFactory {

    public static final String IDENTIFIER = "default";

    public static final ConfigOption<String> DEFAULT_LLM =
            ConfigOptions.key("default-llm")
                    .stringType()
                    .defaultValue("default")
                    .withDescription("Specify the default LLM model name.");

    public static final ConfigOption<String> LANGUAGE =
            ConfigOptions.key("language")
                    .stringType()
                    .defaultValue("Simplified Chinese")
                    .withDescription("The language used in answer during conversations. " +
                            "For example: 'Simplified Chinese', 'English', '简体中文', '英语', etc.");

    public static final ConfigOption<Boolean> INTENT_CLASSIFICATION =
            ConfigOptions.key("intent-classification")
                    .booleanType()
                    .defaultValue(true)
                    .withDescription("Sets whether the intent classification");

    public static final ConfigOption<String> INTENT_CLASSIFICATION_LLM =
            ConfigOptions.key("intent-classification-llm")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Specify the intent classification LLM model name. " +
                            "If not specified, use the default llm.");

    public static final ConfigOption<Boolean> SQL_GENERATION_REASONING =
            ConfigOptions.key("sql-generation-reasoning")
                    .booleanType()
                    .defaultValue(true)
                    .withDescription("Sets whether the SQL generation reasoning");

    public static final ConfigOption<String> SQL_GENERATION_REASONING_LLM =
            ConfigOptions.key("sql-generation-reasoning-llm")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Specify the SQL generation reasoning LLM model name. " +
                            "If not specified, use the default llm.");

    public static final ConfigOption<String> SQL_GENERATION_LLM =
            ConfigOptions.key("sql-generation-llm")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Specify the SQL generation LLM model name. " +
                            "If not specified, use the default llm.");

    public static final ConfigOption<Integer> MAX_HISTORIES =
            ConfigOptions.key("max-histories")
                    .intType()
                    .defaultValue(20)
                    .withDescription("Maximum number of histories");

    public static final ConfigOption<String> TEXT_TO_SQL_RULES =
            ConfigOptions.key("text-to-sql-rules")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("Customize the text-to-SQL rules. " +
                            "When the value is empty, use the built-in text-to-SQL rules.");

    public static final ConfigOption<String> INSTRUCTION =
            ConfigOptions.key("instruction")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("User instruction");

    public static final ConfigOption<Boolean> INDEX_ASK =
            ConfigOptions.key("index-ask")
                    .booleanType()
                    .defaultValue(false)
                    .withDescription("Enable index (KPI) query mode. " +
                            "When enabled, the agent resolves index candidates, data permission, " +
                            "date scenario and column whitelist, then injects them as hard constraints " +
                            "into the SQL generation prompt. " +
                            "Requires org_code and staff_no to be passed in every ask request.");

    public static final ConfigOption<String> INDEX_ASK_LLM =
            ConfigOptions.key("index-ask-llm")
                    .stringType()
                    .noDefaultValue()
                    .withDescription("LLM model name used for index context resolution. " +
                            "If not specified, use the default llm.");

    public static final ConfigOption<Boolean> RULE_BASED_SQL =
            ConfigOptions.key("rule-based-sql")
                    .booleanType()
                    .defaultValue(false)
                    .withDescription("Enable rule-based SQL generation for index queries. " +
                            "Only takes effect when `index-ask` is also enabled. " +
                            "When enabled, matching single-index queries bypass the LLM " +
                            "and use pre-defined SQL templates instead. Default: false.");

    @Override
    public Set<ConfigOption<?>> requiredOptions() {
        return Collections.emptySet();
    }

    @Override
    public Set<ConfigOption<?>> optionalOptions() {
        return new LinkedHashSet<>(List.of(
                DEFAULT_LLM, LANGUAGE, INTENT_CLASSIFICATION, INTENT_CLASSIFICATION_LLM,
                SQL_GENERATION_REASONING, SQL_GENERATION_REASONING_LLM,
                SQL_GENERATION_LLM, MAX_HISTORIES,
                TEXT_TO_SQL_RULES, INSTRUCTION,
                INDEX_ASK, INDEX_ASK_LLM,
                RULE_BASED_SQL
        ));
    }


    @Override
    public String factoryIdentifier() {
        return IDENTIFIER;
    }

    @Override
    public String factoryDescription() {
        return "The default ask data agent is implemented using the workflow mode.";
    }

    @Override
    public AskdataAgent create(@NonNull ReadableConfig config,
                               @NonNull ContentStore contentStore,
                               @NonNull List<ChatModelInstance> chatModelInstances,
                               @NonNull DatabaseAdapter databaseAdapter,
                               Map<String, Object> variables) {
        Preconditions.checkArgument(!chatModelInstances.isEmpty(),
                "chatModelInstances cannot be empty");
        FactoryUtil.validateFactoryOptions(this, config);
        Map<String, ChatModelInstance> instances = chatModelInstances.stream()
                .collect(Collectors.toMap(ChatModelInstance::getName, i -> i));
        validateConfigOptions(config, instances);

        ChatModelInstance defaultInstance = config.getOptional(DEFAULT_LLM)
                .map(instances::get).orElseGet(() -> chatModelInstances.get(0));
        ChatModelInstance intentClassificationInstance = config.getOptional(INTENT_CLASSIFICATION_LLM)
                .map(instances::get).orElse(defaultInstance);
        ChatModelInstance sqlGenerationReasoningInstance = config.getOptional(SQL_GENERATION_REASONING_LLM)
                .map(instances::get).orElse(defaultInstance);
        ChatModelInstance sqlGenerationInstance = config.getOptional(SQL_GENERATION_LLM)
                .map(instances::get).orElse(defaultInstance);
        ChatModelInstance indexAskInstance = config.getOptional(INDEX_ASK_LLM)
                .map(instances::get).orElse(defaultInstance);

        String language = config.get(LANGUAGE);
        boolean intentClassification = config.get(INTENT_CLASSIFICATION);
        boolean sqlGenerationReasoning = config.get(SQL_GENERATION_REASONING);
        boolean indexAsk = config.get(INDEX_ASK);
        boolean ruleBasedSql = config.get(RULE_BASED_SQL);
        Integer maxHistories = config.get(MAX_HISTORIES);

        DefaultAskdataAgent.DefaultAskdataAgentBuilder builder = DefaultAskdataAgent.builder()
                .contentStore(contentStore)
                .defaultModel(defaultInstance.getChatModel())
                .defaultStreamingModel(defaultInstance.getStreamingChatModel())
                .databaseAdapter(databaseAdapter)
                .language(language)
                .intentClassification(intentClassification)
                .intentClassificationModel(intentClassificationInstance.getChatModel())
                .sqlGenerationReasoning(sqlGenerationReasoning)
                .sqlGenerationReasoningModel(sqlGenerationReasoningInstance.getStreamingChatModel())
                .sqlGenerationModel(sqlGenerationInstance.getChatModel())
                .indexAsk(indexAsk)
                .indexAskModel(indexAskInstance.getChatModel())
                .ruleBasedSql(ruleBasedSql)
                .maxHistories(maxHistories);

        config.getOptional(TEXT_TO_SQL_RULES).ifPresent(builder::textToSqlRules);
        config.getOptional(INSTRUCTION).ifPresent(builder::instruction);

        if (variables != null && !variables.isEmpty()) {
            builder.variables(variables);
        }

        return builder.build();
    }

    private void validateConfigOptions(ReadableConfig config, Map<String, ChatModelInstance> instances) {
        config.getOptional(MAX_HISTORIES)
                .ifPresent(n -> Preconditions.checkArgument(n > 0,
                        "'" + MAX_HISTORIES.key() + "' value must be greater than 0"));
        String llmNames = String.join(", ", instances.keySet());
        String errorMessageFormat = "'%s' value must be one of [%s]";
        config.getOptional(DEFAULT_LLM)
                .ifPresent(n -> Preconditions.checkArgument(instances.containsKey(n),
                        String.format(errorMessageFormat, DEFAULT_LLM.key(), llmNames)));
        config.getOptional(INTENT_CLASSIFICATION_LLM)
                .ifPresent(n -> Preconditions.checkArgument(instances.containsKey(n),
                        String.format(errorMessageFormat, INTENT_CLASSIFICATION_LLM.key(), llmNames)));
        config.getOptional(SQL_GENERATION_REASONING_LLM)
                .ifPresent(n -> Preconditions.checkArgument(instances.containsKey(n),
                        String.format(errorMessageFormat, SQL_GENERATION_REASONING_LLM.key(), llmNames)));
        config.getOptional(SQL_GENERATION_LLM)
                .ifPresent(n -> Preconditions.checkArgument(instances.containsKey(n),
                        String.format(errorMessageFormat, SQL_GENERATION_LLM.key(), llmNames)));
        config.getOptional(INDEX_ASK_LLM)
                .ifPresent(n -> Preconditions.checkArgument(instances.containsKey(n),
                        String.format(errorMessageFormat, INDEX_ASK_LLM.key(), llmNames)));
    }
}