package ai.dat.core.agent;

import ai.dat.core.agent.data.EventOption;
import ai.dat.core.configuration.ConfigOption;
import ai.dat.core.configuration.ConfigOptions;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * @Author JunjieM
 * @Date 2025/7/17
 */
public class DefaultEventOptions {

        public static final ConfigOption<String> CONTENT = ConfigOptions.key("content")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("content");

        public static final ConfigOption<String> ERROR = ConfigOptions.key("error")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("error message");

        // ----------------------------- exception --------------------------

        public static final ConfigOption<String> MESSAGE = ConfigOptions.key("message")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("message");

        public static final EventOption EXCEPTION_EVENT = EventOption.builder()
                        .name("exception")
                        .dataOptions(Set.of(MESSAGE))
                        .build();

        // ----------------------------- intent_classification
        // --------------------------

        public static final ConfigOption<String> REASONING = ConfigOptions.key("reasoning")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("Brief chain-of-thought reasoning (max 20 words)");

        public static final ConfigOption<DefaultAskdataAgent.Intent> INTENT = ConfigOptions.key("intent")
                        .enumType(DefaultAskdataAgent.Intent.class)
                        .noDefaultValue()
                        .withDescription("The intent of intent classification");

        public static final ConfigOption<String> REPHRASED_QUESTION = ConfigOptions.key("rephrased_question")
                        .stringType()
                        .noDefaultValue()
                        .withDescription(
                                        "Rephrased question in full standalone question if there are previous questions, "
                                                        +
                                                        "otherwise the original question");

        public static final ConfigOption<List<Map<String, Object>>> SELECTED_INDEX_NUMBERS = ConfigOptions.key("selected_index_numbers")
                        .mapObjectType()
                        .asList()
                        .noDefaultValue()
                        .withDescription(
                                        "Selected indices chosen by LLM from INDEX CONTEXT candidates. " +
                                                        "Each entry: {index_number, standard_name}. " +
                                                        "Only populated when index-ask is enabled and INDEX CONTEXT is present.");

        public static final ConfigOption<List<String>> SELECTED_ORG_CODES = ConfigOptions.key("selected_org_codes")
                        .stringType()
                        .asList()
                        .noDefaultValue()
                        .withDescription(
                                        "Selected org_codes chosen by LLM from ORG CANDIDATES. " +
                                                        "Only populated when index-ask is enabled and org candidates are present.");

        public static final ConfigOption<String> ORG_AGG_MODE = ConfigOptions.key("org_agg_mode")
                        .stringType()
                        .noDefaultValue()
                        .withDescription(
                                        "Organization aggregation mode: SUBTRACT / DIVIDE / COMPARE / SUM. " +
                                                        "Only populated when >=2 orgs are selected.");

        public static final ConfigOption<String> CURRENCY_CODE = ConfigOptions.key("currency_code")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("Currency code detected from the question. Default 'CN' (折人民币).");

        public static final ConfigOption<String> CURRENCY_NAME = ConfigOptions.key("currency_name")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("Currency Chinese name detected from the question. Default '折人民币'.");

        public static final ConfigOption<Map<String, Object>> DATE_INTENT = ConfigOptions.key("date_intent")
                        .mapObjectType()
                        .noDefaultValue()
                        .withDescription("Date intent extracted by LLM: {anchor_type, granularity, exact_date, list_dates, range_start, range_end, window_unit, window_count}");

        public static final ConfigOption<Integer> RANKING_LIMIT = ConfigOptions.key("ranking_limit")
                        .intType()
                        .noDefaultValue()
                        .withDescription("Ranking limit number extracted by LLM. e.g., 1 for 'first', 3 for 'top 3'. null if no ranking intent.");

        public static final ConfigOption<String> RANKING_ORDER = ConfigOptions.key("ranking_order")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("Ranking order: ASC (ascending/lowest) or DESC (descending/highest). Default DESC.");

        public static final EventOption INTENT_CLASSIFICATION_EVENT = EventOption.builder()
                        .name("intent_classification")
                        .dataOptions(Set.of(REPHRASED_QUESTION, REASONING, INTENT, SELECTED_INDEX_NUMBERS,
                                        SELECTED_ORG_CODES, ORG_AGG_MODE, CURRENCY_CODE, CURRENCY_NAME, DATE_INTENT,
                                        RANKING_LIMIT, RANKING_ORDER))
                        .build();

        // ----------------------------- source --------------------------

        public static final ConfigOption<List<String>> TABLES = ConfigOptions.key("tables")
                        .stringType()
                        .asList()
                        .noDefaultValue()
                        .withDescription("The tables used for the query");

        public static final EventOption SOURCE_EVENT = EventOption.builder()
                        .name("source")
                        .dataOptions(Set.of(TABLES))
                        .build();

        // ----------------------------- misleading_assistance
        // --------------------------

        public static final EventOption MISLEADING_ASSISTANCE_EVENT = EventOption.builder()
                        .name("misleading_assistance")
                        .incrementalOption(CONTENT)
                        .dataOptions(Set.of(CONTENT, ERROR))
                        .build();

        // ----------------------------- data_assistance --------------------------

        public static final EventOption DATA_ASSISTANCE_EVENT = EventOption.builder()
                        .name("data_assistance")
                        .incrementalOption(CONTENT)
                        .dataOptions(Set.of(CONTENT, ERROR))
                        .build();

        // ----------------------------- sql_generation_reasoning
        // --------------------------

        public static final EventOption SQL_GENERATION_REASONING_EVENT = EventOption.builder()
                        .name("sql_generation_reasoning")
                        .incrementalOption(CONTENT)
                        .dataOptions(Set.of(CONTENT, ERROR))
                        .build();

        // ----------------------------- sql_generate --------------------------

        public static final ConfigOption<String> SQL = ConfigOptions.key("sql")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("SQL");

        public static final EventOption SQL_GENERATE_EVENT = EventOption.builder()
                        .name("sql_generate")
                        .semanticSqlOption(SQL)
                        .dataOptions(Set.of(SQL))
                        .build();

        // ----------------------------- semantic_to_sql --------------------------

        public static final EventOption SEMANTIC_TO_SQL_EVENT = EventOption.builder()
                        .name("semantic_to_sql")
                        .querySqlOption(SQL)
                        .dataOptions(Set.of(SQL, ERROR))
                        .build();

        // ----------------------------- sql_execute --------------------------

        public static final ConfigOption<List<Map<String, Object>>> DATA = ConfigOptions.key("data")
                        .mapObjectType()
                        .asList()
                        .noDefaultValue()
                        .withDescription("The data queried from the database");

        public static final EventOption SQL_EXECUTE_EVENT = EventOption.builder()
                        .name("sql_execute")
                        .queryDataOption(DATA)
                        .dataOptions(Set.of(DATA, ERROR))
                        .build();

        // ----------------------------- sql_fix --------------------------

        public static final ConfigOption<String> ORIGINAL_SQL = ConfigOptions.key("original_sql")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("Original SQL before fix");

        public static final ConfigOption<String> FIXED_SQL = ConfigOptions.key("fixed_sql")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("Fixed SQL after repair");

        public static final ConfigOption<String> EXECUTION_ERROR = ConfigOptions.key("execution_error")
                        .stringType()
                        .noDefaultValue()
                        .withDescription("SQL execution error message");

        public static final ConfigOption<Integer> FIX_ITERATION = ConfigOptions.key("fix_iteration")
                        .intType()
                        .noDefaultValue()
                        .withDescription("Current fix iteration number");

        public static final EventOption SQL_FIX_EVENT = EventOption.builder()
                        .name("sql_fix")
                        .dataOptions(Set.of(ORIGINAL_SQL, FIXED_SQL, EXECUTION_ERROR, FIX_ITERATION))
                        .build();

        // ----------------------------- similar_question (指标问数多口径提示) --------------------------

        public static final ConfigOption<List<Map<String, Object>>> CALIBER_GROUPS =
                        ConfigOptions.key("caliber_groups")
                                        .mapObjectType()
                                        .asList()
                                        .noDefaultValue()
                                        .withDescription("Multi-caliber index groups: list of " +
                                                        "{standard_name, entries:[{index_number, standard_name, " +
                                                        "aliases, source, frequency}]}. " +
                                                        "Frontend renders this as 'You may also ask: XX caliber'.");

        public static final ConfigOption<List<Map<String, Object>>> SIMILAR_INDICES =
                        ConfigOptions.key("similar_indices")
                                        .mapObjectType()
                                        .asList()
                                        .noDefaultValue()
                                        .withDescription("Indices recalled from vector store that LLM did NOT select for this question. " +
                                                        "Each entry: {index_number, standard_name, aliases, source, frequency}. " +
                                                        "Frontend renders this as 'You may also be interested in: XX'.");

        public static final EventOption SIMILAR_QUESTION_EVENT = EventOption.builder()
                        .name("similar_question")
                        .dataOptions(Set.of(CALIBER_GROUPS, SIMILAR_INDICES))
                        .build();
}
