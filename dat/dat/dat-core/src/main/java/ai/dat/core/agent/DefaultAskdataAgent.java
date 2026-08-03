package ai.dat.core.agent;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.agent.data.EventOption;
import ai.dat.core.agent.data.StreamAction;
import ai.dat.core.agent.data.StreamEvent;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.*;
import ai.dat.core.index.data.DateScenario;
import ai.dat.core.index.data.IndexCaliberGroup;
import ai.dat.core.index.data.IndexContext;
import ai.dat.core.index.data.QueryKind;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.base.Preconditions;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.StreamingChatModel;
import dev.langchain4j.model.output.structured.Description;
import dev.langchain4j.service.*;
import lombok.*;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import static ai.dat.core.agent.DefaultEventOptions.*;

/**
 * @Author JunjieM
 * @Date 2025/6/25
 */
@Slf4j
public class DefaultAskdataAgent extends AbstractAskdataAgent {

    /**
     * Agent.ask(..., attributes) 中用于透传 {@link IndexContext} 的 key。
     * 与 AskController / McpToolsService 端写入侧约定保持一致。
     */
    public static final String ATTR_INDEX_CONTEXT = "__index_context__";
    /** 用于透传 BM25 索引实例（v3 新增）。 */
    public static final String ATTR_BM25_INDEX = "__bm25_index__";

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();
    private static final String TEXT_TO_SQL_RULES;

    static {
        TEXT_TO_SQL_RULES = loadText("prompts/default/text_to_sql_rules.txt");
    }

    private static String loadText(String fromResource) {
        try (InputStream inputStream = DefaultAskdataAgent.class.getClassLoader()
                .getResourceAsStream(fromResource)) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("Failed to load text from resources: " + fromResource, e);
        }
    }

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final String language;
    private final boolean intentClassification;
    private final boolean sqlGenerationReasoning;
    private final String textToSqlRules;
    private final Integer maxHistories;
    private final String instruction;
    private final boolean sqlFix;
    private final int sqlFixMaxIterations;
    private final boolean indexAsk;
    private final boolean ruleBasedSql;

    private final Assistant streamingAssistant;

    private final Assistant intentClassificationAssistant;
    /** 指标问数专用意图分类 Assistant，使用精简版提示词 */
    private final Assistant indexAskIntentClassificationAssistant;
    private final Assistant sqlGenerationReasoningAssistant;
    private final Assistant sqlGenerationAssistant;
    private final Assistant sqlFixerAssistant;
    /** 用于指标库相关的辅助 LLM 调用(目前 Resolver 在外部完成,此字段预留给 reasoning 等扩展)。 */
    private final ChatModel indexAskModel;

    @Builder
    private DefaultAskdataAgent(@NonNull ContentStore contentStore,
            @NonNull DatabaseAdapter databaseAdapter,
            @NonNull ChatModel defaultModel,
            @NonNull StreamingChatModel defaultStreamingModel,
            String language,
            Boolean intentClassification,
            ChatModel intentClassificationModel,
            Boolean sqlGenerationReasoning,
            StreamingChatModel sqlGenerationReasoningModel,
            ChatModel sqlGenerationModel,
            String textToSqlRules,
            Integer maxHistories,
            String instruction,
            Boolean sqlFix,
            Integer sqlFixMaxIterations,
            ChatModel sqlFixModel,
            Boolean indexAsk,
            ChatModel indexAskModel,
            Boolean ruleBasedSql,
            Map<String, Object> variables) {
        super(contentStore, databaseAdapter, variables);
        this.language = Optional.ofNullable(language).orElse("English");
        this.intentClassification = Optional.ofNullable(intentClassification).orElse(true);
        this.sqlGenerationReasoning = Optional.ofNullable(sqlGenerationReasoning).orElse(true);
        this.textToSqlRules = Optional.ofNullable(textToSqlRules).orElse(TEXT_TO_SQL_RULES);
        this.maxHistories = Optional.ofNullable(maxHistories).orElse(20);
        Preconditions.checkArgument(this.maxHistories > 0,
                "maxHistories must be greater than 0");
        this.instruction = Optional.ofNullable(instruction).orElse("");
        this.sqlFix = Optional.ofNullable(sqlFix).orElse(true);
        this.sqlFixMaxIterations = Optional.ofNullable(sqlFixMaxIterations).orElse(3);
        Preconditions.checkArgument(this.sqlFixMaxIterations > 0,
                "sqlFixMaxIterations must be greater than 0");
        this.indexAsk = Optional.ofNullable(indexAsk).orElse(false);
        this.ruleBasedSql = Optional.ofNullable(ruleBasedSql).orElse(false);
        this.indexAskModel = indexAskModel;

        this.streamingAssistant = AiServices.builder(Assistant.class)
                .streamingChatModel(defaultStreamingModel)
                .build();
        this.intentClassificationAssistant = AiServices.builder(Assistant.class)
                .chatModel(Objects.requireNonNullElse(intentClassificationModel, defaultModel))
                .build();
        this.indexAskIntentClassificationAssistant = AiServices.builder(Assistant.class)
                .chatModel(Objects.requireNonNullElse(intentClassificationModel, defaultModel))
                .build();
        this.sqlGenerationReasoningAssistant = AiServices.builder(Assistant.class)
                .streamingChatModel(Objects.requireNonNullElse(sqlGenerationReasoningModel, defaultStreamingModel))
                .build();
        this.sqlGenerationAssistant = AiServices.builder(Assistant.class)
                .chatModel(Objects.requireNonNullElse(sqlGenerationModel, defaultModel))
                .build();
        this.sqlFixerAssistant = AiServices.builder(Assistant.class)
                .chatModel(Objects.requireNonNullElse(sqlFixModel, defaultModel))
                .build();
    }

    @Override
    public Set<EventOption> eventOptions() {
        return Set.of(EXCEPTION_EVENT, INTENT_CLASSIFICATION_EVENT, SOURCE_EVENT,
                MISLEADING_ASSISTANCE_EVENT, DATA_ASSISTANCE_EVENT,
                SQL_GENERATION_REASONING_EVENT, SQL_GENERATE_EVENT, SQL_FIX_EVENT,
                SQL_EXECUTE_EVENT, SIMILAR_QUESTION_EVENT);
    }

    @Override
    protected void run(@NonNull String question, @NonNull List<QuestionSqlPair> histories) {
        String userQuestion = question;
        String questionTime = LocalDateTime.now().format(FORMATTER);

        histories = histories.subList(Math.max(0, histories.size() - maxHistories), histories.size());

        ContentStore contentStore = contentStore();

        // === Load All Light Schemas ===
        List<LightSchema> allLightSchemas = contentStore.allLightSchemas();
        Preconditions.checkArgument(allLightSchemas != null && !allLightSchemas.isEmpty(),
                "Light schemas is empty. Please generate Light Schema first.");

        // Prepare table metadata for intent classification (ClaudeSkills style: name +
        // description only)
        List<String> tableMetadata = allLightSchemas.stream()
                .map(s -> "Table: " + s.getTableName()
                        + (s.getTableDescription() != null ? " - " + s.getTableDescription() : ""))
                .collect(Collectors.toList());

        log.info("Using Light Schema mode with {} tables available.", allLightSchemas.size());

        // 4 路向量检索本来彼此独立，串行执行 = 4×(embed + search)，开销 2-6s。
        // 改为并行后总耗时退化到最慢的那一路，整体 wall-time 通常降到 1.5s 以内。
        CompletableFuture<List<CellMatch>> cellsFuture =
                CompletableFuture.supplyAsync(() -> contentStore.retrieveCells(question, 10), executor);
        CompletableFuture<List<QuestionSqlPair>> sqlSamplesFuture =
                CompletableFuture.supplyAsync(() -> contentStore.retrieveSql(question), executor);
        CompletableFuture<List<WordSynonymPair>> synonymsFuture =
                CompletableFuture.supplyAsync(() -> contentStore.retrieveSyn(question), executor);
        CompletableFuture<List<String>> docsFuture =
                CompletableFuture.supplyAsync(() -> contentStore.retrieveDoc(question), executor);

        CompletableFuture.allOf(cellsFuture, sqlSamplesFuture, synonymsFuture, docsFuture).join();

        List<CellMatch> cellMatches = cellsFuture.join();
        List<QuestionSqlPair> sqlSamples = sqlSamplesFuture.join();
        List<WordSynonymPair> synonyms = synonymsFuture.join();
        List<String> docs = new ArrayList<>(docsFuture.join());

        // Add cell matches to context
        if (cellMatches != null && !cellMatches.isEmpty()) {
            String cellContext = cellMatches.stream()
                    .map(CellMatch::toMatchString)
                    .collect(Collectors.joining(", "));
            docs.add("Possible value matches in database: [" + cellContext + "]");
        }

        List<String> finalSemantics;

        // 取请求级 IndexContext(项目级 index-ask 开关 + AskController 注入了非空 Context 才生效)。
        // 提前在意图分类之前取一次,供两阶段共用:
        //   1) 意图分类:让 LLM 看到候选指标,避免把"统计在编人数"这类问题误判为 MISLEADING_QUERY
        //   2) SQL 生成:注入 INDEX QUERY CONSTRAINTS 段
        IndexContext indexContext = null;
        if (this.indexAsk) {
            Object attr = requestAttributes().get(ATTR_INDEX_CONTEXT);
            if (attr instanceof IndexContext ic && ic.isEnabled()) {
                indexContext = ic;
            }
        }
        // ── 相似问(异步独立通道) ──
        // 设计:用用户原始提问做向量召回(不带口径过滤),与主问数流程完全并行。
        //   - 启动:确认 index-ask 启用后立即发起,利用意图分类/SQL 生成的秒级窗口完成召回;
        //   - 合流:run() 末尾发 SIMILAR_QUESTION_EVENT 前带超时取回,
        //     按"同族不同口径优先 → 跨族补足"排序,排除已选中项与 caliberGroups 已覆盖项,取 TOP3;
        //   - 失败/超时:降级为空,绝不影响主问数结果返回。
        CompletableFuture<List<IndexEntry>> similarRecallFuture = null;
        if (this.indexAsk && indexContext != null && indexContext.getProjectId() != null) {
            final String similarProjectId = indexContext.getProjectId();
            similarRecallFuture = CompletableFuture.supplyAsync(() -> {
                try {
                    List<IndexEntry> hits = contentStore.retrieveIndexEntries(similarProjectId, question, 20);
                    return hits != null ? hits : Collections.<IndexEntry>emptyList();
                } catch (Exception e) {
                    log.warn("Async similar-question recall failed: {}", e.getMessage());
                    return Collections.<IndexEntry>emptyList();
                }
            }, executor);
        }
        // 合流时需要的最终选中状态(在意图分类块内填充):排除集 + 选中指标的族名
        final Set<String> similarExcludedNumbers = new HashSet<>();
        final Set<String> similarSelectedFamilies = new HashSet<>();
        List<IndexEntry> similarIndices = Collections.emptyList();
        // 意图分类输出的 selected_tables 在 run() 末尾用于规则 SQL 的表名拼接;
        // 单表才允许走规则 SQL,多表/无表必须降级到 LLM 生成。
        String ruleBasedTable = null;

        // 指标问数模式开启但 Resolver 未命中任何指标（index-ask disabled）：
        // 说明问题中的指标名在指标库中不存在，直接返回提示，不走 LLM 意图分类。
        if (this.indexAsk && indexContext == null) {
            String hint = "未在指标库中找到匹配的指标。请检查指标名称是否正确，或尝试以下方式：\n"
                    + "- 使用指标的标准名称（如「各项存款余额」）\n"
                    + "- 使用指标的常用别名\n"
                    + "- 在指标库管理页面查看所有可用指标";
            action.add(StreamEvent.from(MISLEADING_ASSISTANCE_EVENT).set(CONTENT, hint));
            action.finished();
            return;
        }

        if (intentClassification) {
            String llmPickedIndexNumber = null;
            if (indexContext != null && indexContext.isEnabled()) {
                List<IndexEntry> retrievedCandidates =
                        indexContext.getIndexCandidates();
                int candidateCount = (retrievedCandidates == null) ? 0 : retrievedCandidates.size();
                if (candidateCount == 1) {
                    llmPickedIndexNumber = retrievedCandidates.get(0).getIndexNumber();
                } else if (candidateCount > 1) {
                    // 候选数量少于等于 3 时，跳过 cross-encoder 过滤，直接使用所有候选
                    // 因为候选少说明前面的召回（同义词+BM25）已经很精准，cross-encoder 可能误杀
                    if (candidateCount <= 3) {
                        log.info("Index candidates={}<=3, skipping cross-encoder filter for question [{}]",
                                candidateCount, question.length() > 60 ? question.substring(0, 60) + "..." : question);
                    } else {
                        // 用 cross-encoder 对所有候选评分，窄化到 top-5
                        List<IndexEntry> scored = narrowByCrossEncoder(question, retrievedCandidates, 5);
                        // 检查最佳匹配的分数：低于阈值说明候选全是噪声，直接禁用 index-ask
                        double bestScore = bestCrossEncoderScore(question, scored);
                        if (bestScore < 0.01) {
                            log.info("Cross-encoder best score {} below threshold for question [{}], index-ask disabled",
                                    bestScore, question.length() > 60 ? question.substring(0, 60) + "..." : question);
                            indexContext = null;  // 禁用，触发下方"未找到匹配指标"提示
                        } else {
                            indexContext = indexContext.toBuilder().indexCandidates(scored).build();
                            log.info("Cross-encoder narrowed index candidates from {} to {} (bestScore={}) for question [{}]",
                                    candidateCount, scored.size(), bestScore,
                                    question.length() > 60 ? question.substring(0, 60) + "..." : question);
                        }
                    }
                }
                // candidateCount == 0 → 降级
            }

            // 意图分类:始终通过 LLM 运行,不做 fast path 跳过。
            // 即使指标已由 Resolver + 精排确定,仍需要 LLM 完成:
            //   - 机构匹配(selected_org_codes)
            //   - 表选择(selected_tables)
            //   - 问题改写(rephrased_question)
            // 指标选择已被 llmPickedIndexNumber 固定,下面会覆盖 LLM 的 selected_index_numbers。
            IntentClassificationIndexAsk intentClass = intentClassification(tableMetadata, sqlSamples,
                    synonyms, docs, histories, questionTime, question, indexContext);

            // 意图分类异常兜底检测：LLM 调用失败时返回默认 TEXT_TO_SQL（无指标/机构），
            // index-ask 模式下不应继续走 SQL 生成，直接返回错误提示
            if (indexContext != null && indexContext.isEnabled()
                    && intentClass.getIntent() == Intent.TEXT_TO_SQL
                    && (intentClass.getSelected_index_numbers() == null || intentClass.getSelected_index_numbers().isEmpty())
                    && (intentClass.getSelected_org_codes() == null || intentClass.getSelected_org_codes().isEmpty())
                    && (intentClass.getReasoning() == null || intentClass.getReasoning().isBlank())) {
                action.add(StreamEvent.from(MISLEADING_ASSISTANCE_EVENT)
                        .set(CONTENT, "抱歉，指标识别服务暂时不可用，请稍后重试或输入完整的指标名称（如「各项存款余额(人行口径)」）。"));
                action.finished();
                return;
            }

            // ── v3: 混合检索精排（BM25 + 向量 RRF） ──
            if (indexContext != null && indexContext.isEnabled()) {
                Object bm25Obj = requestAttributes().get(ATTR_BM25_INDEX);
                ai.dat.core.index.bm25.IndexBm25Index bm25 = null;
                if (bm25Obj instanceof ai.dat.core.index.bm25.IndexBm25Index) {
                    bm25 = (ai.dat.core.index.bm25.IndexBm25Index) bm25Obj;
                }
                List<IndexEntry> reRanked = ai.dat.core.index.resolver.IndexContextResolver.hybridRerank(
                        indexContext.getIndexCandidates(),
                        question,
                        intentClass.getQuery_expansions(),
                        contentStore,
                        indexContext.getProjectId(),
                        80,
                        bm25);
                if (!reRanked.isEmpty()) {
                    indexContext = indexContext.toBuilder().indexCandidates(reRanked).build();
                    log.info("Hybrid rerank: {} candidates after BM25+RRF fusion", reRanked.size());
                }
            }

            // 精确命中时:若意图分类未返回指标(空列表),回填 llmPickedIndexNumber;
            // 若意图分类已返回多条(例如口径歧义场景),保留 LLM 的完整选择,不覆盖
            if (llmPickedIndexNumber != null && indexContext != null) {
                if (intentClass.getSelected_index_numbers() == null
                        || intentClass.getSelected_index_numbers().isEmpty()) {
                    intentClass.setSelected_index_numbers(List.of(llmPickedIndexNumber));
                }
                if (intentClass.getIntent() != Intent.TEXT_TO_SQL) {
                    intentClass.setIntent(Intent.TEXT_TO_SQL);
                }
            }

            // fast path 只填了 selected_index_numbers，没填 selected_tables。
            // 指标问数本质上只查那张 KPI 表(含 index_number 列),这里按约定补齐表名:
            //   - 单表项目直接用唯一表名
            //   - 多表项目按 column 名 index_number 识别 KPI 表
            // 这样下游的 LLM-table-fallback 警告不再触发,rule-based SQL fast path 也能命中。
            if (intentClass.getSelected_tables() == null || intentClass.getSelected_tables().isEmpty()) {
                String kpiTable = inferKpiTableName(allLightSchemas);
                if (kpiTable != null) {
                    intentClass.setSelected_tables(new ArrayList<>(List.of(kpiTable)));
                }
            }

            // Filter relevant full light schemas based on selected tables
            List<String> selectedTableNames = intentClass.getSelected_tables();
            // 只有 LLM 明确选中单表时才允许规则 SQL,多表场景需要 JOIN,无法用模板覆盖
            if (selectedTableNames != null && selectedTableNames.size() == 1) {
                String onlyTable = selectedTableNames.get(0);
                if (onlyTable != null && !onlyTable.isBlank()) {
                    ruleBasedTable = onlyTable;
                }
            }
            List<LightSchema> selectedSchemas;
            if (selectedTableNames == null || selectedTableNames.isEmpty()) {
                log.warn("No tables selected by LLM for intent: {}. Falling back to all schemas.",
                        intentClass.getIntent());
                selectedSchemas = allLightSchemas;
            } else {
                selectedSchemas = allLightSchemas.stream()
                        .filter(s -> selectedTableNames.contains(s.getTableName()))
                        .collect(Collectors.toList());
                log.info("LLM selected {}/{} tables: {}", selectedSchemas.size(), allLightSchemas.size(),
                        selectedTableNames);
            }

            finalSemantics = selectedSchemas.stream()
                    .map(LightSchema::toMarkdown)
                    .collect(Collectors.toList());

            StreamEvent event = StreamEvent.from(INTENT_CLASSIFICATION_EVENT)
                    .set(INTENT, intentClass.intent);
            Optional.ofNullable(intentClass.rephrased_question)
                    .ifPresent(o -> event.set(REPHRASED_QUESTION, o));
            Optional.ofNullable(intentClass.reasoning)
                    .ifPresent(o -> event.set(REASONING, o));
            // 输出意图分类得到的指标编码（enriched: index_number + standard_name）
            final IndexContext indexContextForEvent = indexContext;
            Optional.ofNullable(intentClass.getSelected_index_numbers())
                    .filter(l -> !l.isEmpty())
                    .ifPresent(o -> event.set(SELECTED_INDEX_NUMBERS,
                            toSelectedIndexMaps(o, indexContextForEvent)));
            // 输出意图分类得到的机构编码
            Optional.ofNullable(intentClass.getSelected_org_codes())
                    .filter(l -> !l.isEmpty())
                    .ifPresent(o -> event.set(SELECTED_ORG_CODES, o));
            // 输出意图分类得到的机构聚合模式
            Optional.ofNullable(intentClass.org_agg_mode)
                    .filter(s -> !s.isBlank())
                    .ifPresent(o -> event.set(ORG_AGG_MODE, o));
            // 输出意图分类得到的币种
            Optional.ofNullable(intentClass.currency_code)
                    .filter(s -> !s.isBlank())
                    .ifPresent(o -> event.set(CURRENCY_CODE, o));
            Optional.ofNullable(intentClass.currency_name)
                    .filter(s -> !s.isBlank())
                    .ifPresent(o -> event.set(CURRENCY_NAME, o));
            // 输出意图分类得到的日期意图
            Optional.ofNullable(intentClass.date_intent)
                    .filter(di -> di.getAnchorType() != null && di.getAnchorType() != ai.dat.core.index.data.DateIntent.AnchorType.NONE)
                    .ifPresent(o -> event.set(DATE_INTENT, dateIntentToMap(o)));
            // 输出意图分类得到的排名信息
            Optional.ofNullable(intentClass.ranking_limit)
                    .ifPresent(o -> event.set(RANKING_LIMIT, o));
            Optional.ofNullable(intentClass.ranking_order)
                    .filter(s -> !s.isBlank())
                    .ifPresent(o -> event.set(RANKING_ORDER, o));

            // 若 LLM 从 INDEX CONTEXT 候选(全量库)里选出了具体指标:
            //   1) 窄化 indexContext.indexCandidates -> SQL 生成提示词只剩选中的几条
            //   2) 用 selected.standardName 在全量库内回填同名不同口径条目 -> caliberGroups (相似问)
            //   3) 记录排除集/选中族名,供 run() 末尾的异步相似问通道合流排序用(similarIndices)
            // 注意:不再像旧版那样把"候选里未被选中"的留作 similarIndices——现在 candidates 是全量库,
            //       未选中的数百条不可能都是相似问。
            List<String> selectedIndexNumbers = intentClass.getSelected_index_numbers();
            List<String> selectedOrgCodes = intentClass.getSelected_org_codes();
            boolean hasCaliberAmbiguity = false;  // 外层声明，供下游口径歧义检测使用

            // 机构权限检查：信任 LLM 的 mentioned_org_count，只做算术比较。
            // ——不再用正则去猜"和/与/以及/、/相差"等，LLM 语义理解远优于关键词匹配。
            int mentionedOrgs = intentClass.getMentioned_org_count() != null
                    ? intentClass.getMentioned_org_count() : 0;
            int matchedOrgs = (selectedOrgCodes != null) ? selectedOrgCodes.size() : 0;

            if (indexContext != null && indexContext.getMentionedOrgCandidates() != null
                    && indexContext.getQueryKind() != QueryKind.RANKING
                    && mentionedOrgs > matchedOrgs) {
                if (matchedOrgs == 0) {
                    // 用户提到了机构但 LLM 一个都没匹配到 → 全部不在权限范围
                    List<String> accessibleOrgNames = indexContext.getMentionedOrgCandidates().stream()
                            .map(IndexContext.OrgCandidate::getOrgName)
                            .filter(Objects::nonNull)
                            .distinct()
                            .collect(Collectors.toList());
                    String orgListHint = accessibleOrgNames.isEmpty()
                            ? "无可访问机构"
                            : String.join("、", accessibleOrgNames);
                    action.add(StreamEvent.from(MISLEADING_ASSISTANCE_EVENT)
                            .set(CONTENT, String.format(
                                    "您提及的机构不在查询权限范围内。您当前可查询的机构包括：%s",
                                    orgListHint)));
                    action.finished();
                    return;
                } else {
                    // 用户提到了多个机构但只匹配到部分 → 部分无权限
                    String matchedOrgName = indexContext.getMentionedOrgCandidates().stream()
                            .filter(c -> selectedOrgCodes.contains(c.getOrgCode()))
                            .map(IndexContext.OrgCandidate::getOrgName)
                            .findFirst().orElse(selectedOrgCodes.get(0));
                    action.add(StreamEvent.from(MISLEADING_ASSISTANCE_EVENT)
                            .set(CONTENT, String.format(
                                    "您的问题涉及%d个机构，但您当前仅有「%s」的查询权限。请联系管理员开通其他机构的数据权限。",
                                    mentionedOrgs, matchedOrgName)));
                    action.finished();
                    return;
                }
            }

            // 处理 LLM 识别的机构：如果 LLM 从候选中选出了机构，更新 indexContext 的机构解析结果
            if (selectedOrgCodes != null && !selectedOrgCodes.isEmpty()
                    && indexContext != null && indexContext.getMentionedOrgCandidates() != null
                    && !indexContext.getMentionedOrgCandidates().isEmpty()) {
                // 根据 LLM 选择的 org_codes 构建最终的机构解析
                ai.dat.core.index.resolver.IndexContextResolver.OrgResolution orgResolution =
                        ai.dat.core.index.resolver.IndexContextResolver.resolveOrgSelection(
                                selectedOrgCodes, indexContext.getMentionedOrgCandidates(), question,
                                intentClass.org_agg_mode);

                // 更新 queryOrgCodes：优先使用 LLM 选中的机构
                List<String> queryOrgs;
                if (!orgResolution.orgCodes().isEmpty()) {
                    queryOrgs = orgResolution.orgCodes();
                } else {
                    queryOrgs = indexContext.getQueryOrgCodes();
                }

                // 根据新的机构解析结果，重新计算 queryKind：
                // - MULTI_AGGREGATION → ORG_AGGREGATION（聚合/对比/求差/求比由 orgAggregationMode 决定）
                // - 其余保持原 queryKind（例如 RANKING / STANDARD）
                QueryKind newQueryKind = indexContext.getQueryKind();
                if (orgResolution.mode() == IndexContext.OrgResolutionMode.MULTI_AGGREGATION
                        && newQueryKind != QueryKind.RANKING) {
                    newQueryKind = QueryKind.ORG_AGGREGATION;
                }

                // 重建 indexContext，注入 LLM 解析的机构信息
                ai.dat.core.index.resolver.DateIntentExpander.Result expandedDate = resolveDateIntent(intentClass, question);
                indexContext = IndexContext.builder()
                        .enabled(indexContext.isEnabled())
                        .projectId(indexContext.getProjectId())
                        .indexCandidates(indexContext.getIndexCandidates())
                        .indexReferenceSummaries(indexContext.getIndexReferenceSummaries())
                        .caliberGroups(indexContext.getCaliberGroups())
                        .accessibleOrgCodes(indexContext.getAccessibleOrgCodes())
                        .queryOrgCodes(queryOrgs)
                        .resolvedOrgCodes(orgResolution.orgCodes())
                        .resolvedOrgNames(orgResolution.orgNames())
                        .mentionedOrgCandidates(orgResolution.candidates())
                        .orgResolutionMode(orgResolution.mode())
                        .orgAggregationMode(orgResolution.aggregationMode())
                        .dateScenario(expandedDate.getScenario())
                        .dateValues(expandedDate.getValues())
                        .dateRangeStart(expandedDate.getStart())
                        .dateRangeEnd(expandedDate.getEnd())
                        .selectColumnsWhitelist(indexContext.getSelectColumnsWhitelist())
                        .queryKind(newQueryKind)
                        .rankingOrgLevelLabel(indexContext.getRankingOrgLevelLabel())
                        .currencyCode(resolveCurrencyCode(intentClass, question))
                        .currencyName(resolveCurrencyName(intentClass, question))
                        .rankingLimit(intentClass.getRanking_limit())
                        .rankingOrder(resolveRankingOrder(intentClass))
                        .build();

                log.info("LLM resolved orgs: {} from {} candidates, aggregationMode={}, queryKind={}, rankingLimit={}, rankingOrder={}",
                        orgResolution.orgCodes(),
                        indexContext.getMentionedOrgCandidates().size(),
                        orgResolution.aggregationMode(),
                        newQueryKind,
                        indexContext.getRankingLimit(),
                        indexContext.getRankingOrder());
            }

            if (selectedIndexNumbers != null && !selectedIndexNumbers.isEmpty()) {
                event.set(SELECTED_INDEX_NUMBERS,
                        toSelectedIndexMaps(selectedIndexNumbers, indexContext));

                // 窄化 indexContext.indexCandidates:
                // 早期检查已经保证 selectedIndexNumbers 只有 1 条(或口径歧义的少数几条),
                // 这里按 selected 过滤 candidates,传给下游 SQL 生成。
                if (indexContext != null && indexContext.getIndexCandidates() != null
                        && !indexContext.getIndexCandidates().isEmpty()) {
                    List<IndexEntry> originalCandidates =
                            indexContext.getIndexCandidates();
                    // 候选集 index_number 快照（只读不变，供校验 lambda 引用）
                    final Set<String> candidateIndexNumbers = originalCandidates.stream()
                            .map(IndexEntry::getIndexNumber)
                            .filter(Objects::nonNull)
                            .collect(Collectors.toSet());

                    // 校验 LLM 返回的 selected_index_numbers 是否都在候选集中，
                    // 过滤掉 LLM 幻觉编造的口径变体（如指标库只有 source=1 的条目，
                    // LLM 却编造了 source=2/3 的 index_number）
                    List<String> fabricated = selectedIndexNumbers.stream()
                            .filter(num -> !candidateIndexNumbers.contains(num))
                            .toList();
                    if (!fabricated.isEmpty()) {
                        log.warn("LLM fabricated {} index numbers not in candidates: {} — filtered out. "
                                + "Candidates had {} entries. Original question: [{}]",
                                fabricated.size(), fabricated,
                                originalCandidates.size(),
                                question.length() > 80 ? question.substring(0, 80) + "..." : question);
                        selectedIndexNumbers = selectedIndexNumbers.stream()
                                .filter(num -> !fabricated.contains(num))
                                .collect(Collectors.toList());
                        intentClass.setSelected_index_numbers(selectedIndexNumbers);
                    }

                    final Set<String> picked = new HashSet<>(selectedIndexNumbers);
                    List<IndexEntry> narrowed = originalCandidates.stream()
                            .filter(e -> picked.contains(e.getIndexNumber()))
                            .collect(Collectors.toList());

                    // 口径歧义检测：多条 narrowed 共享同一个 baseName（去掉口径括号）但 source 不同
                    // 例如 "各项存款余额(人行口径)" / "各项存款余额(监管口径)" / "各项存款余额(省联社口径)"
                    hasCaliberAmbiguity = narrowed.size() > 1 && narrowed.stream()
                            .map(e -> extractIndexFamilyName(e.getStandardName()))
                            .distinct().count() == 1
                            && narrowed.stream().map(IndexEntry::getSource).filter(Objects::nonNull).distinct().count() > 1;

                    // 多口径分组:在全量库内查 standardName 命中的所有 source
                    List<IndexCaliberGroup> caliberGroups = hasCaliberAmbiguity
                            ? ai.dat.core.index.resolver.IndexContextResolver.resolveCaliberGroups(
                                    picked, originalCandidates)
                            : Collections.emptyList();

                    // 若选中多条且规则 SQL 要求恰好 1 条，用 cross-encoder 选最优的一条保证规则 SQL 命中。
                    // 但以下情况不窄化：
                    //   口径歧义 → 保留全部变体，触发模糊问让用户选择口径
                    //   多指标（不同族名）→ 保留全部，让规则 SQL fallthrough 到 LLM 生成
                    boolean multiMetric = narrowed.size() > 1 && narrowed.stream()
                            .map(e -> extractIndexFamilyName(e.getStandardName()))
                            .distinct().count() > 1;
                    if (narrowed.size() > 1 && this.ruleBasedSql && !hasCaliberAmbiguity && !multiMetric) {
                        List<IndexEntry> best = narrowByCrossEncoder(question, narrowed, 1);
                        log.info("Post-intent cross-encoder narrowed selected indices from {} to {}: {}",
                                narrowed.size(), best.size(), best.stream().map(IndexEntry::getIndexNumber).toList());
                        narrowed = best;
                        selectedIndexNumbers = best.stream().map(IndexEntry::getIndexNumber).toList();
                        intentClass.setSelected_index_numbers(selectedIndexNumbers);
                    }

                    // 字段白名单沿用 IndexContextResolver 按 QueryKind 选定的 STANDARD/RANKING 白名单,
                    // 不再为同业指标(TY)切换到 INTERBANK 10 字段白名单:线上同业表缺
                    // primart_category / secondary_category,强制 SELECT 会导致 LLM 生成的 SQL 失败。
                    // 同业指标查询统一交给大模型基于实际表结构生成。

                    // 3) 相似问状态记录:具体召回在异步通道完成(见 run() 开头 similarRecallFuture),
                    //    这里只把合流所需的状态记录下来——
                    //      - 排除集:已选中项 + caliberGroups 已覆盖项(避免双倍展示)
                    //      - 选中指标的族名:合流排序时"同族不同口径优先"用
                    similarExcludedNumbers.addAll(selectedIndexNumbers);
                    for (IndexCaliberGroup g : caliberGroups) {
                        if (g.getEntries() != null) {
                            for (IndexEntry e : g.getEntries()) {
                                if (e.getIndexNumber() != null) {
                                    similarExcludedNumbers.add(e.getIndexNumber());
                                }
                            }
                        }
                    }
                    narrowed.stream()
                            .map(e -> extractIndexFamilyName(e.getStandardName()))
                            .filter(f -> f != null && !f.isEmpty())
                            .forEach(similarSelectedFamilies::add);

                    if (!narrowed.isEmpty()) {
                        ai.dat.core.index.resolver.DateIntentExpander.Result expandedDate2 =
                                resolveDateIntent(intentClass, question);
                        indexContext = IndexContext.builder()
                                .enabled(indexContext.isEnabled())
                                .projectId(indexContext.getProjectId())
                                .indexCandidates(narrowed)
                                .caliberGroups(caliberGroups)
                                .accessibleOrgCodes(indexContext.getAccessibleOrgCodes())
                                .queryOrgCodes(indexContext.getQueryOrgCodes())
                                .resolvedOrgCodes(indexContext.getResolvedOrgCodes())
                                .resolvedOrgNames(indexContext.getResolvedOrgNames())
                                .mentionedOrgCandidates(indexContext.getMentionedOrgCandidates())
                                .orgResolutionMode(indexContext.getOrgResolutionMode())
                                .orgAggregationMode(indexContext.getOrgAggregationMode())
                                .dateScenario(indexContext.getDateScenario())
                                .dateValues(indexContext.getDateValues())
                                .dateRangeStart(indexContext.getDateRangeStart())
                                .dateScenario(expandedDate2.getScenario())
                                .dateValues(expandedDate2.getValues())
                                .dateRangeStart(expandedDate2.getStart())
                                .dateRangeEnd(expandedDate2.getEnd())
                                .selectColumnsWhitelist(indexContext.getSelectColumnsWhitelist())
                                .queryKind(indexContext.getQueryKind())
                                .rankingOrgLevelLabel(indexContext.getRankingOrgLevelLabel())
                                .currencyCode(resolveCurrencyCode(intentClass, question))
                                .currencyName(resolveCurrencyName(intentClass, question))
                                .rankingLimit(intentClass.getRanking_limit())
                                .rankingOrder(resolveRankingOrder(intentClass))
                                .build();
                        log.info("IndexContext rebuilt with rankingLimit={}, rankingOrder={}",
                                indexContext.getRankingLimit(), indexContext.getRankingOrder());
                    }
                }
            }
            action.add(event);

            // 口径歧义检测：narrowed 中存在同一指标族的多个口径变体时，
            // 不生成 SQL，走模糊问流程——列出检索到的指标让用户选择口径
            if (hasCaliberAmbiguity && indexContext != null
                    && indexContext.getIndexCandidates() != null) {
                // 用 indexCandidates（narrowed 后的口径变体）做模糊问展示
                List<IndexEntry> ambiguousEntries = indexContext.getIndexCandidates();
                String ambiguousMsg = buildAmbiguousIndexMessage(question, ambiguousEntries);
                StreamEvent caliberEvent = StreamEvent.from(SIMILAR_QUESTION_EVENT)
                        .set(CALIBER_GROUPS, serializeCaliberGroups(indexContext.getCaliberGroups()));
                action.add(caliberEvent);
                action.add(StreamEvent.from(MISLEADING_ASSISTANCE_EVENT)
                        .set(CONTENT, ambiguousMsg));
                action.finished();
                return;
            }

            // Record the selected tables as source event
            if (selectedTableNames != null && !selectedTableNames.isEmpty()) {
                action.add(StreamEvent.from(SOURCE_EVENT).set(TABLES, selectedTableNames));
            }

            String rephrasedQuestion = intentClass.rephrased_question;
            // 保留原始 userQuestion 用于规则 SQL 生成（需要检测"前三"等排名关键词）和 LLM SQL 生成

            Intent intent = intentClass.intent;
            String userCompositeQuestion = null;
            if (Intent.MISLEADING_QUERY == intent || Intent.GENERAL == intent) {
                userCompositeQuestion = histories.stream()
                        .map(QuestionSqlPair::getQuestion)
                        .collect(Collectors.joining("\n"))
                        + "\n" + userQuestion;
            }

            if (Intent.MISLEADING_QUERY == intent) {
                TokenStream tokenStream = streamingAssistant.misleadingAssistance(
                        finalSemantics, questionTime, userCompositeQuestion, language);
                CompletableFuture<Void> future = new CompletableFuture<>();
                tokenStream
                        .onPartialResponse(s -> action.add(StreamEvent.from(MISLEADING_ASSISTANCE_EVENT, CONTENT, s)))
                        .onCompleteResponse(r -> future.complete(null))
                        .onError(e -> {
                            action.add(StreamEvent.from(MISLEADING_ASSISTANCE_EVENT, ERROR, e.getMessage()));
                            future.completeExceptionally(e);
                        })
                        .start();
                future.join();
                return;
            } else if (Intent.GENERAL == intent) {
                TokenStream tokenStream = streamingAssistant.dataAssistance(
                        finalSemantics, questionTime, userCompositeQuestion, language);
                CompletableFuture<Void> future = new CompletableFuture<>();
                tokenStream.onPartialResponse(s -> action.add(StreamEvent.from(DATA_ASSISTANCE_EVENT, CONTENT, s)))
                        .onCompleteResponse(r -> future.complete(null))
                        .onError(e -> {
                            action.add(StreamEvent.from(DATA_ASSISTANCE_EVENT, ERROR, e.getMessage()));
                            future.completeExceptionally(e);
                        })
                        .start();
                future.join();
                return;
            }
        } else {
            // If intent classification is disabled, use all schemas
            finalSemantics = allLightSchemas.stream()
                    .map(LightSchema::toMarkdown)
                    .collect(Collectors.toList());
        }

        List<QuestionSqlPair> sqlSamplesForGeneration = limitSqlSamplesForGeneration(sqlSamples, indexContext);
        List<String> docsForGeneration = limitDocsForGeneration(docs, indexContext);

        // 生成查询SQL
        List<String> dataSamples = Collections.emptyList(); // Light Schema mode doesn't use data samples from semantic
                                                            // models
        String generatedSql;
        Optional<String> ruleBasedSql = this.ruleBasedSql && ruleBasedTable != null
                ? buildRuleBasedSql(userQuestion, ruleBasedTable, indexContext)  // 使用原始问题，保留"前三"等关键词
                : Optional.empty();
        boolean ruleBasedSqlHit = ruleBasedSql.isPresent();
        if (ruleBasedSqlHit) {
            generatedSql = ruleBasedSql.get();
            action.add(StreamEvent.from(SQL_GENERATE_EVENT, SQL, generatedSql));
            log.info("Rule-based SQL fast path hit");
        } else {
            generatedSql = generateSql(action, finalSemantics, dataSamples, sqlSamplesForGeneration, synonyms,
                    docsForGeneration,
                    instruction, histories, questionTime, userQuestion, indexContext);  // 使用原始问题，不使用重写后的
        }
        log.info("generatedSql: " + generatedSql);

        // SQL 修复（如果启用）
        if (sqlFix && !ruleBasedSqlHit) {
            generatedSql = fixSql(action, generatedSql, finalSemantics, userQuestion);
            log.info("fixedSql: " + generatedSql);
        }

        // 执行SQL
        try {
            executeQuery(generatedSql);
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }

        // 相似问合流:取回异步召回结果(用户原始提问的向量近邻),过滤已选中/已覆盖项,
        // 同族不同口径优先、跨族补足,取 TOP3。带超时,超时则放弃相似问,绝不阻塞主问数结果返回。
        if (similarRecallFuture != null) {
            try {
                List<IndexEntry> recalled = similarRecallFuture.get(1500, TimeUnit.MILLISECONDS);
                similarIndices = selectSimilarQuestions(recalled, similarExcludedNumbers,
                        similarSelectedFamilies, 3);
            } catch (Exception e) {
                log.warn("Similar-question recall not ready in time, skipped: {}", e.getMessage());
            }
        }
        // 相似问触发:
        //   1) 多口径同名指标(caliberGroups,例如各项存款余额 既有人行口径又有银监口径)
        //   2) 异步召回的近邻指标(similarIndices,例如问"存款余额"时召回了贷款余额、对公存款等)
        // 任一非空都发 similar_question 事件,前端展示"您可能还想问"。
        boolean hasCaliber = indexContext != null
                && indexContext.getCaliberGroups() != null
                && !indexContext.getCaliberGroups().isEmpty();
        boolean hasSimilar = similarIndices != null && !similarIndices.isEmpty();
        if (hasCaliber || hasSimilar) {
            StreamEvent similarEvent = StreamEvent.from(SIMILAR_QUESTION_EVENT);
            if (hasCaliber) {
                similarEvent.set(CALIBER_GROUPS, serializeCaliberGroups(indexContext.getCaliberGroups()));
            }
            if (hasSimilar) {
                similarEvent.set(SIMILAR_INDICES, serializeIndexEntries(similarIndices));
            }
            action.add(similarEvent);
        }
    }

    /**
     * 相似问排序与截断:与选中指标同族(族名相同,即不同口径)的优先,跨族按召回顺序补足,取 TOP-N。
     *
     * @param recalled         异步召回的候选(按向量相关性排序)
     * @param excluded         需排除的 indexNumber(已选中 + caliberGroups 已覆盖)
     * @param selectedFamilies 选中指标的族名集合(去掉"(xx 口径)"后的基础名)
     * @param topN             返回上限
     */
    private static List<IndexEntry> selectSimilarQuestions(List<IndexEntry> recalled,
                                                           Set<String> excluded,
                                                           Set<String> selectedFamilies,
                                                           int topN) {
        if (recalled == null || recalled.isEmpty() || topN <= 0) {
            return Collections.emptyList();
        }
        List<IndexEntry> sameFamily = new ArrayList<>();
        List<IndexEntry> crossFamily = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (IndexEntry e : recalled) {
            if (e == null || e.getIndexNumber() == null
                    || excluded.contains(e.getIndexNumber())
                    || !seen.add(e.getIndexNumber())) {
                continue;
            }
            String fam = extractIndexFamilyName(e.getStandardName());
            if (fam != null && !fam.isEmpty() && selectedFamilies.contains(fam)) {
                sameFamily.add(e);
            } else {
                crossFamily.add(e);
            }
        }
        List<IndexEntry> out = new ArrayList<>(topN);
        for (IndexEntry e : sameFamily) {
            if (out.size() >= topN) break;
            out.add(e);
        }
        for (IndexEntry e : crossFamily) {
            if (out.size() >= topN) break;
            out.add(e);
        }
        return out;
    }

    private IntentClassificationIndexAsk intentClassification(List<String> semantics,
            List<QuestionSqlPair> sqlSamples,
            List<WordSynonymPair> synonyms,
            List<String> docs,
            List<QuestionSqlPair> histories,
            String questionTime,
            String question,
            IndexContext indexContext) {
        try {
            // 指标问数模式：使用精简版提示词
            boolean useIndexAskPrompt = indexContext != null && indexContext.isEnabled();
            if (useIndexAskPrompt) {
                log.info("Using index-ask intent classification with optimized prompt and schema");
                IntentClassificationIndexAsk result = indexAskIntentClassificationAssistant
                        .indexAskIntentClassification(semantics, sqlSamples,
                                synonyms, docs, histories, questionTime, question, language, indexContext);
                return result;
            }
            // 普通问数模式：使用原版 IntentClassification
            IntentClassification ic = intentClassificationAssistant.intentClassification(semantics, sqlSamples,
                    synonyms, docs, histories, questionTime, question, language, indexContext);
            // 将 IntentClassification 转换为 IntentClassificationIndexAsk
            IntentClassificationIndexAsk result = new IntentClassificationIndexAsk(ic.getIntent());
            result.setRephrased_question(ic.getRephrased_question());
            result.setReasoning(ic.getReasoning());
            result.setSelected_tables(ic.getSelected_tables());
            return result;
        } catch (dev.langchain4j.service.output.OutputParsingException e) {
            // LangChain4j JSON 解析失败 → 尝试手动从异常消息中提取 JSON 再解析
            log.warn("Intent classification OutputParsingException, trying manual JSON extraction");
            String raw = e.getMessage();
            if (raw != null) {
                IntentClassification manual = parseIntentClassificationFromRaw(raw);
                if (manual != null) {
                    log.info("Manual JSON extraction succeeded for intent classification");
                    IntentClassificationIndexAsk result = new IntentClassificationIndexAsk(manual.getIntent());
                    result.setRephrased_question(manual.getRephrased_question());
                    result.setReasoning(manual.getReasoning());
                    result.setSelected_tables(manual.getSelected_tables());
                    return result;
                }
            }
            log.warn("Intent classification exception (fallback to default)", e);
            return new IntentClassificationIndexAsk(Intent.TEXT_TO_SQL);
        } catch (Exception e) {
            log.warn("Intent classification exception", e);
            return new IntentClassificationIndexAsk(Intent.TEXT_TO_SQL);
        }
    }

    private static IntentClassification parseIntentClassificationFromRaw(String raw) {
        try {
            // 从 OutputParsingException 消息中提取 JSON 部分（从第一个 { 到最后一个 }）
            int first = raw.indexOf('{');
            int last = raw.lastIndexOf('}');
            if (first < 0 || last <= first) return null;
            String json = raw.substring(first, last + 1);
            return JSON_MAPPER.readValue(json, IntentClassification.class);
        } catch (Exception e) {
            log.debug("Manual JSON extraction failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 从问题文本里抽取所有非口径 note 词,例如 "保证金存款金额(对公)" → ["对公"]。
     * 与 standardName 里 () 的语义一致,过滤掉 人行口径/监管口径/省联社口径 等 caliber 词。
     */
    private static List<String> extractExplicitNotes(String question) {
        if (question == null || question.isEmpty()) {
            return Collections.emptyList();
        }
        String normalized = question.replace('（', '(').replace('）', ')');
        List<String> notes = new ArrayList<>();
        int from = 0;
        while (from < normalized.length()) {
            int l = normalized.indexOf('(', from);
            if (l < 0) break;
            int r = normalized.indexOf(')', l + 1);
            if (r < 0) break;
            String note = normalized.substring(l + 1, r).trim();
            from = r + 1;
            if (note.isEmpty()) continue;
            if (note.equals("人行口径") || note.equals("人民银行口径")
                    || note.equals("监管口径") || note.equals("银监口径")
                    || note.equals("省联社口径") || note.equals("人行")) {
                continue;
            }
            notes.add(note);
        }
        return notes;
    }

    /**
     * 候选条目的 standardName/aliases 是否提到任一 expected note 词。
     */
    private static boolean entryMentionsAnyNote(IndexEntry entry, List<String> expectedNotes) {
        if (entry == null || expectedNotes == null || expectedNotes.isEmpty()) {
            return false;
        }
        for (String note : expectedNotes) {
            if (note == null || note.isEmpty()) continue;
            if (entry.getStandardName() != null && entry.getStandardName().contains(note)) {
                return true;
            }
            if (entry.getAliases() != null) {
                for (String alias : entry.getAliases()) {
                    if (alias != null && alias.contains(note)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * fast path 命中后给 selected_tables 补一张 KPI 表名。
     * 项目只有 1 张表直接取它;多张表按约定挑包含 index_number 列的那张;都识别不出返回 null。
     */
    private static String inferKpiTableName(List<LightSchema> allLightSchemas) {
        if (allLightSchemas == null || allLightSchemas.isEmpty()) {
            return null;
        }
        if (allLightSchemas.size() == 1) {
            return allLightSchemas.get(0).getTableName();
        }
        for (LightSchema schema : allLightSchemas) {
            if (schema.getColumns() == null) {
                continue;
            }
            boolean hasIndexNumber = schema.getColumns().stream()
                    .anyMatch(c -> c != null && "index_number".equalsIgnoreCase(c.getName()));
            if (hasIndexNumber) {
                return schema.getTableName();
            }
        }
        return null;
    }

    private boolean matchesIndexEntry(String question, IndexEntry candidate) {
        if (question == null || question.isBlank() || candidate == null) {
            return false;
        }
        if (candidate.getStandardName() != null && question.contains(candidate.getStandardName())) {
            return true;
        }
        if (candidate.getAliases() == null || candidate.getAliases().isEmpty()) {
            return false;
        }
        for (String alias : candidate.getAliases()) {
            if (alias != null && !alias.isBlank() && question.contains(alias)) {
                return true;
            }
        }
        return false;
    }

    private List<QuestionSqlPair> limitSqlSamplesForGeneration(List<QuestionSqlPair> sqlSamples,
            IndexContext indexContext) {
        if (sqlSamples == null || sqlSamples.isEmpty()) {
            return Collections.emptyList();
        }
        if (indexContext == null || !indexContext.isEnabled()) {
            return sqlSamples;
        }
        return sqlSamples.stream().limit(1).collect(Collectors.toList());
    }

    private List<String> limitDocsForGeneration(List<String> docs, IndexContext indexContext) {
        if (docs == null || docs.isEmpty()) {
            return Collections.emptyList();
        }
        if (indexContext == null || !indexContext.isEnabled()) {
            return docs;
        }
        List<String> limited = new ArrayList<>();
        int totalLength = 0;
        for (String doc : docs) {
            if (doc == null || doc.isBlank()) {
                continue;
            }
            if (totalLength >= 1200) {
                break;
            }
            limited.add(doc);
            totalLength += doc.length();
        }
        return limited;
    }

    private Optional<String> buildRuleBasedSql(String question, String tableName, IndexContext indexContext) {
        String dialect = databaseAdapter.getDialect();
        return RuleBasedSqlBuilder.build(question, tableName, indexContext, dialect);
    }

    private String generateSql(StreamAction action,
            List<String> semanticContexts,
            List<String> dataSamples,
            List<QuestionSqlPair> sqlSamples,
            List<WordSynonymPair> synonyms,
            List<String> docs,
            String instruction,
            List<QuestionSqlPair> histories,
            String questionTime,
            String question,
            IndexContext indexContext) {
        String dialect = databaseAdapter.getDialect();
        AtomicReference<String> sqlGenerateReasoning = new AtomicReference<>("");
        boolean skipReasoningForIndexAsk = indexContext != null && indexContext.isEnabled();
        if (sqlGenerationReasoning && !skipReasoningForIndexAsk) {
            TokenStream tokenStream;
            if (histories.isEmpty()) {
                tokenStream = sqlGenerationReasoningAssistant.sqlGenerateReasoning(
                        semanticContexts, dataSamples, sqlSamples, synonyms, docs, instruction,
                        questionTime, question, dialect, language);
            } else {
                tokenStream = sqlGenerationReasoningAssistant.followupSqlGenerateReasoning(
                        semanticContexts, dataSamples, sqlSamples, synonyms, docs, instruction,
                        histories, questionTime, question, dialect, language);
            }
            CompletableFuture<Void> future = new CompletableFuture<>();
            tokenStream.onPartialResponse(c -> {
                action.add(StreamEvent.from(SQL_GENERATION_REASONING_EVENT, CONTENT, c));
                sqlGenerateReasoning.updateAndGet(s -> s + c);
            })
                    .onCompleteResponse(c -> future.complete(null))
                    .onError(e -> {
                        action.add(StreamEvent.from(SQL_GENERATION_REASONING_EVENT, ERROR, e.getMessage()));
                        sqlGenerateReasoning.set(""); // 异常则清空推理
                    })
                    .start();
            future.join();
        }

        GenSql genSql;
        if (histories.isEmpty()) {
            genSql = sqlGenerationAssistant.sqlGenerate(textToSqlRules, semanticContexts,
                    dataSamples, sqlSamples, synonyms, docs, instruction, questionTime, question,
                    dialect, sqlGenerateReasoning.get(), language, indexContext);
        } else {
            genSql = sqlGenerationAssistant.followupSqlGenerate(textToSqlRules, semanticContexts,
                    dataSamples, sqlSamples, synonyms, docs, instruction, histories, questionTime, question,
                    dialect, sqlGenerateReasoning.get(), indexContext);
        }

        action.add(StreamEvent.from(SQL_GENERATE_EVENT, SQL, genSql.sql));

        return genSql.sql;
    }

    /**
     * SQL 修复方法 - 仅在 SQLException 时迭代修复 SQL，空结果不再触发修复。
     * 之前的策略会对"查询合法但返回空"的合理结果做最多 N 次 LLM 修复，徒增 10-30s 延迟，
     * 也会把"用户问的就是没数据"的场景错改成另一条 SQL。
     */
    private String fixSql(StreamAction action,
            String sql,
            List<String> semanticContexts,
            String question) {
        String currentSql = sql;
        String schema = String.join("\n\n", semanticContexts);
        String dialect = databaseAdapter.getDialect();

        for (int i = 0; i < sqlFixMaxIterations; i++) {
            try {
                List<Map<String, Object>> results = databaseAdapter.executeQuery(currentSql);
                // 不再因为空结果触发修复 —— 直接返回。
                log.info("SQL execution successful with {} rows",
                        results == null ? 0 : results.size());
                return currentSql;
            } catch (SQLException e) {
                String errorMessage = "SQL Error: " + e.getMessage();
                log.warn("SQL fix iteration {}: {}", i + 1, errorMessage);

                String fixedSql = callLlmToFix(dialect, schema, question, currentSql, errorMessage);

                if (fixedSql != null && !fixedSql.equals(currentSql)) {
                    action.add(StreamEvent.from(SQL_FIX_EVENT)
                            .set(ORIGINAL_SQL, currentSql)
                            .set(FIXED_SQL, fixedSql)
                            .set(EXECUTION_ERROR, errorMessage)
                            .set(FIX_ITERATION, i + 1));
                    currentSql = fixedSql;
                } else {
                    log.warn("SQL fixer could not improve the query, returning current SQL");
                    return currentSql;
                }
            }
        }

        log.warn("SQL fix reached max iterations ({}), returning last SQL", sqlFixMaxIterations);
        return currentSql;
    }

    /**
     * 调用 LLM 修复 SQL
     */
    private String callLlmToFix(String dialect, String schema, String question, String originalSql,
            String executionResult) {
        try {
            String response = sqlFixerAssistant.sqlFix(dialect, schema, question, originalSql, executionResult);
            return extractSqlFromResponse(response);
        } catch (Exception e) {
            log.error("Failed to call LLM for SQL fix", e);
            return null;
        }
    }

    /**
     * 从 LLM 响应中提取 SQL
     */
    private String extractSqlFromResponse(String response) {
        if (response == null || response.isBlank()) {
            return null;
        }

        // 优先匹配 ```sql ... ``` 代码块
        java.util.regex.Pattern sqlPattern = java.util.regex.Pattern.compile(
                "```sql\\s*(.*?)\\s*```",
                java.util.regex.Pattern.DOTALL | java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher sqlMatcher = sqlPattern.matcher(response);
        if (sqlMatcher.find()) {
            return sqlMatcher.group(1).trim();
        }

        // 回退：匹配任意 ``` ... ``` 代码块
        java.util.regex.Pattern codePattern = java.util.regex.Pattern.compile(
                "```\\s*(.*?)\\s*```",
                java.util.regex.Pattern.DOTALL);
        java.util.regex.Matcher codeMatcher = codePattern.matcher(response);
        if (codeMatcher.find()) {
            return codeMatcher.group(1).trim();
        }

        // 无代码块时返回原文
        return response.trim();
    }

    private static class GenSql {
        @Description("SQL query string in the specified dialect")
        private String sql;
    }

    public enum Intent {
        MISLEADING_QUERY, // 误导性问题
        TEXT_TO_SQL, // 文本转SQL
        GENERAL // 一般性问题
        ;
    }

        @Getter
    @Setter
    @NoArgsConstructor
    private static class IntentClassification {
        @Description("rephrased question in full standalone question if there are previous questions, " +
                "otherwise the original question")
        @JsonProperty("rephrased_question")
        private String rephrased_question;

        @Description("brief chain-of-thought reasoning (max 20 words)")
        private String reasoning;

        @Description("\"MISLEADING_QUERY\" | \"TEXT_TO_SQL\" | \"GENERAL\"")
        private Intent intent;

        @Description("List of table names selected for the query (only for TEXT_TO_SQL, GENERAL intent)")
        @JsonProperty("selected_tables")
        private List<String> selected_tables = new ArrayList<>();

        public IntentClassification(Intent intent) {
            this.intent = intent;
        }
    }

    /**
     * 指标问数专用精简版 IntentClassification。
     * <p>使用更短的 @Description 注解，减少 LangChain4j 自动生成的 JSON schema 说明长度，
     * 从而降低 prompt token 数量，加快 LLM 推理速度。
     */
    @Getter
    @Setter
    @NoArgsConstructor
    private static class IntentClassificationIndexAsk {
        @Description("standalone question")
        @JsonProperty("rephrased_question")
        private String rephrased_question;

        @Description("reasoning (max 20 words)")
        private String reasoning;

        @Description("intent enum")
        private Intent intent;

        @Description("table names")
        @JsonProperty("selected_tables")
        private List<String> selected_tables = new ArrayList<>();

        @Description("index_numbers from library")
        @JsonProperty("selected_index_numbers")
        private List<String> selected_index_numbers = new ArrayList<>();

        @Description("org_codes matched")
        @JsonProperty("selected_org_codes")
        private List<String> selected_org_codes = new ArrayList<>();

        @Description("has caliber variants")
        @JsonProperty("has_ambiguous_caliber")
        private Boolean has_ambiguous_caliber = false;

        @Description("date intent")
        @JsonProperty("date_intent")
        private ai.dat.core.index.data.DateIntent date_intent;

        @Description("currency code")
        @JsonProperty("currency_code")
        private String currency_code;

        @Description("currency name")
        @JsonProperty("currency_name")
        private String currency_name;

        @Description("org count in question")
        @JsonProperty("mentioned_org_count")
        private Integer mentioned_org_count;

        @Description("org aggregation mode")
        @JsonProperty("org_agg_mode")
        private String org_agg_mode;

        @Description("alternative phrasings")
        @JsonProperty("query_expansions")
        private List<String> query_expansions = new ArrayList<>();

        @Description("ranking limit number, null if no ranking")
        @JsonProperty("ranking_limit")
        private Integer ranking_limit;

        @Description("ranking order: ASC/DESC")
        @JsonProperty("ranking_order")
        private String ranking_order;

        public IntentClassificationIndexAsk(Intent intent) {
            this.intent = intent;
        }

        /**
         * 转换为标准 IntentClassification 对象
         */
        public IntentClassification toIntentClassification() {
            IntentClassification ic = new IntentClassification(this.intent);
            ic.setRephrased_question(this.rephrased_question);
            ic.setReasoning(this.reasoning);
            ic.setSelected_tables(this.selected_tables);
            return ic;
        }
    }

    /**
     * 从 LLM 意图分类结果展开日期意图。
     * <p>LLM 输出抽象的 (anchor, granularity) → DateIntentExpander 展开为具体 DateScenario + 日期值。
     * <p>失败时回退到规则 DateScenarioDetector。
     */
    private static ai.dat.core.index.resolver.DateIntentExpander.Result resolveDateIntent(
            IntentClassificationIndexAsk ic, String question) {
        // IntentClassificationIndexAsk 包含 date_intent 字段
        ai.dat.core.index.data.DateIntent intent = ic.getDate_intent();
        if (intent != null && intent.getAnchorType() != null
                && intent.getAnchorType() != ai.dat.core.index.data.DateIntent.AnchorType.NONE) {
            ai.dat.core.index.resolver.DateIntentExpander.Result expanded =
                    new ai.dat.core.index.resolver.DateIntentExpander().expand(intent);
            if (expanded.getScenario() != DateScenario.NONE) {
                return expanded;
            }
        }
        // 回退规则检测器
        ai.dat.core.index.resolver.DateScenarioDetector.Result dr =
                new ai.dat.core.index.resolver.DateScenarioDetector().detect(question);
        return ai.dat.core.index.resolver.DateIntentExpander.Result.builder()
                .scenario(dr.getScenario() == null ? DateScenario.NONE : dr.getScenario())
                .values(dr.getValues() == null ? Collections.emptyList() : dr.getValues())
                .start(dr.getStart())
                .end(dr.getEnd())
                .build();
    }

    private static String resolveCurrencyCode(IntentClassificationIndexAsk ic, String question) {
        // IntentClassificationIndexAsk 包含 currency_code 字段
        if (ic.getCurrency_code() != null && !ic.getCurrency_code().isBlank()) {
            return ic.getCurrency_code();
        }
        return new ai.dat.core.index.resolver.CurrencyDetector().detect(question).getCurrencyCode();
    }

    private static String resolveCurrencyName(IntentClassificationIndexAsk ic, String question) {
        // IntentClassificationIndexAsk 包含 currency_name 字段
        if (ic.getCurrency_name() != null && !ic.getCurrency_name().isBlank()) {
            return ic.getCurrency_name();
        }
        return new ai.dat.core.index.resolver.CurrencyDetector().detect(question).getCurrencyName();
    }

    private static String resolveRankingOrder(IntentClassificationIndexAsk ic) {
        if (ic.getRanking_order() != null && !ic.getRanking_order().isBlank()) {
            return ic.getRanking_order().toUpperCase();
        }
        return "DESC";
    }

    /**
     * 将 LLM 输出的 DateIntent 转换为 Map，用于输出到 INTENT_CLASSIFICATION_EVENT 响应流。
     * <p>仅输出非 null 的字段，避免前端收到大量 null 值。
     */
    private static Map<String, Object> dateIntentToMap(ai.dat.core.index.data.DateIntent di) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (di.getAnchorType() != null) {
            map.put("anchor_type", di.getAnchorType().name());
        }
        if (di.getGranularity() != null) {
            map.put("granularity", di.getGranularity().name());
        }
        if (di.getExactDate() != null) {
            map.put("exact_date", di.getExactDate());
        }
        if (di.getListDates() != null && !di.getListDates().isEmpty()) {
            map.put("list_dates", di.getListDates());
        }
        if (di.getRangeStart() != null) {
            map.put("range_start", di.getRangeStart());
        }
        if (di.getRangeEnd() != null) {
            map.put("range_end", di.getRangeEnd());
        }
        if (di.getWindowUnit() != null) {
            map.put("window_unit", di.getWindowUnit().name());
        }
        if (di.getWindowCount() != null) {
            map.put("window_count", di.getWindowCount());
        }
        return map;
    }

    private interface Assistant {
        @SystemMessage(fromResource = "prompts/default/intent_classification_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/intent_classification_user_prompt_template.txt")
        IntentClassification intentClassification(@V("semantic_models") List<String> semanticModels,
                @V("sql_samples") List<QuestionSqlPair> sqlSamples,
                @V("synonyms") List<WordSynonymPair> synonyms,
                @V("docs") List<String> docs,
                @V("histories") List<QuestionSqlPair> histories,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("language") String language,
                @V("index_context") IndexContext indexContext);

        @SystemMessage(fromResource = "prompts/default/intent_classification_index_ask_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/intent_classification_index_ask_user_prompt_template.txt")
        IntentClassificationIndexAsk indexAskIntentClassification(@V("semantic_models") List<String> semanticModels,
                @V("sql_samples") List<QuestionSqlPair> sqlSamples,
                @V("synonyms") List<WordSynonymPair> synonyms,
                @V("docs") List<String> docs,
                @V("histories") List<QuestionSqlPair> histories,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("language") String language,
                @V("index_context") IndexContext indexContext);

        @SystemMessage(fromResource = "prompts/default/misleading_assistance_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/misleading_assistance_user_prompt_template.txt")
        TokenStream misleadingAssistance(@V("semantic_models") List<String> semanticModels,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("language") String language);

        @SystemMessage(fromResource = "prompts/default/data_assistance_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/data_assistance_user_prompt_template.txt")
        TokenStream dataAssistance(@V("semantic_models") List<String> semanticModels,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("language") String language);

        @SystemMessage(fromResource = "prompts/default/sql_generation_reasoning_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/sql_generation_reasoning_user_prompt_template.txt")
        TokenStream sqlGenerateReasoning(@V("semantic_models") List<String> semanticModels,
                @V("data_samples") List<String> dataSamples,
                @V("sql_samples") List<QuestionSqlPair> sqlSamples,
                @V("synonyms") List<WordSynonymPair> synonyms,
                @V("docs") List<String> docs,
                @V("instruction") String instruction,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("dialect") String dialect,
                @V("language") String language);

        @SystemMessage(fromResource = "prompts/default/sql_generation_reasoning_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/sql_generation_reasoning_with_followup_user_prompt_template.txt")
        TokenStream followupSqlGenerateReasoning(@V("semantic_models") List<String> semanticModels,
                @V("data_samples") List<String> dataSamples,
                @V("sql_samples") List<QuestionSqlPair> sqlSamples,
                @V("synonyms") List<WordSynonymPair> synonyms,
                @V("docs") List<String> docs,
                @V("instruction") String instruction,
                @V("histories") List<QuestionSqlPair> histories,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("dialect") String dialect,
                @V("language") String language);

        @SystemMessage(fromResource = "prompts/default/sql_generation_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/sql_generation_user_prompt_template.txt")
        GenSql sqlGenerate(@V("text_to_sql_rules") String textToSqlRules,
                @V("semantic_models") List<String> semanticModels,
                @V("data_samples") List<String> dataSamples,
                @V("sql_samples") List<QuestionSqlPair> sqlSamples,
                @V("synonyms") List<WordSynonymPair> synonyms,
                @V("docs") List<String> docs,
                @V("instruction") String instruction,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("dialect") String dialect,
                @V("sql_generation_reasoning") String sqlGenerationReasoning,
                @V("language") String language,
                @V("index_context") IndexContext indexContext);

        @SystemMessage(fromResource = "prompts/default/sql_generation_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/sql_generation_with_followup_user_prompt_template.txt")
        GenSql followupSqlGenerate(@V("text_to_sql_rules") String textToSqlRules,
                @V("semantic_models") List<String> semanticModels,
                @V("data_samples") List<String> dataSamples,
                @V("sql_samples") List<QuestionSqlPair> sqlSamples,
                @V("synonyms") List<WordSynonymPair> synonyms,
                @V("docs") List<String> docs,
                @V("instruction") String instruction,
                @V("histories") List<QuestionSqlPair> histories,
                @V("query_time") String queryTime,
                @V("query") String query,
                @V("dialect") String dialect,
                @V("sql_generation_reasoning") String sqlGenerationReasoning,
                @V("index_context") IndexContext indexContext);

        @SystemMessage(fromResource = "prompts/default/sql_fixer_system_prompt.txt")
        @UserMessage(fromResource = "prompts/default/sql_fixer_user_prompt_template.txt")
        String sqlFix(@V("dialect") String dialect,
                @V("schema") String schema,
                @V("question") String question,
                @V("original_sql") String originalSql,
                @V("execution_result") String executionResult);
    }

    /**
     * 获取候选中 cross-encoder 最高分，用于判断候选是否为噪声。
     */
    private double bestCrossEncoderScore(String question, List<IndexEntry> candidates) {
        if (candidates == null || candidates.isEmpty()) return -1.0;
        return candidates.stream()
                .mapToDouble(e -> {
                    String doc = e.getStandardName();
                    if (e.getAliases() != null && !e.getAliases().isEmpty()) {
                        doc += " " + String.join(" ", e.getAliases());
                    }
                    return contentStore().scoreRelevance(question, doc);
                })
                .max().orElse(-1.0);
    }

    /**
     * 用 cross-encoder 评分从候选中窄化到 topK 条。
     * <p>比 LLM 精排快得多（毫秒级 vs 秒级），用于缩小意图分类 prompt 中的 INDEX LIBRARY。
     */
    private List<IndexEntry> narrowByCrossEncoder(String question, List<IndexEntry> candidates, int topK) {
        if (candidates == null || candidates.size() <= topK) return candidates;
        return candidates.stream()
                .map(e -> {
                    String doc = e.getStandardName();
                    if (e.getAliases() != null && !e.getAliases().isEmpty()) {
                        doc += " " + String.join(" ", e.getAliases());
                    }
                    double score = contentStore().scoreRelevance(question, doc);
                    return new AbstractMap.SimpleEntry<>(e, score);
                })
                .sorted(Map.Entry.<IndexEntry, Double>comparingByValue().reversed())
                .limit(topK)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    /**
     * LLM 精排:从向量召回的多个候选指标中挑出唯一最匹配用户问题的指标。
     * <p>只关注问题中的指标关键词,忽略机构名和时间表达式。
     * <p>返回最佳 indexNumber;LLM 判断歧义时返回 empty。
     */
    private Optional<String> llmPickBestIndex(String question,
                                               List<IndexEntry> candidates) {
        if (indexAskModel == null || candidates == null || candidates.isEmpty()) {
            return Optional.empty();
        }
        // ── v3: Cross-encoder rerank（候选 >10 时启用）──
        List<IndexEntry> topCandidates;
        if (candidates.size() > 10) {
            topCandidates = candidates.stream()
                    .map(e -> {
                        String doc = e.getStandardName();
                        if (e.getAliases() != null && !e.getAliases().isEmpty()) {
                            doc += " " + String.join(" ", e.getAliases());
                        }
                        double score = contentStore().scoreRelevance(question, doc);
                        return new AbstractMap.SimpleEntry<>(e, score);
                    })
                    .sorted(Map.Entry.<IndexEntry, Double>comparingByValue().reversed())
                    .limit(10)
                    .map(Map.Entry::getKey)
                    .collect(Collectors.toList());
        } else {
            topCandidates = candidates;
        }

        StringBuilder candList = new StringBuilder();
        for (IndexEntry e : topCandidates) {
            candList.append("- `").append(e.getIndexNumber()).append("`: ")
                    .append(e.getStandardName());
            if (e.getAliases() != null && !e.getAliases().isEmpty()) {
                candList.append("  [aliases: ").append(String.join(", ", e.getAliases())).append("]");
            }
            candList.append("\n");
        }

        String systemPrompt = """
                You are a banking KPI metric matcher. Pick the SINGLE best-matching indicator from a candidate list.

                ### Rules ###
                1. Focus ONLY on the metric/keyword in the question. IGNORE organization names (e.g. 北京城南支行, 总行), time expressions (e.g. 上个月, 去年), and quantity words.
                2. Match by SEMANTIC meaning, not exact text:
                   - "存款总额" ≈ "各项存款余额"
                   - "贷款金额" ≈ "各项贷款金额"
                   - "客户数" ≈ "贷款客户数"
                   - "存款" ≈ "各项存款余额"
                3. CRITICAL: if the core concept in the question does NOT exist in any candidate, output NONE.
                   - "在编人数" ≠ "员工数" (在编=正式编制, 员工=all staff)
                   - "零跑" ✅ "当年开户零跑数" (same concept)
                   - "绿色信贷" ✅ "绿色贷款不良率" (same domain)
                   Do NOT force-match a wrong concept just because it shares one word.
                4. Output EXACTLY the index_number (e.g. KPI5009_01) of the best match, or the word NONE.
                5. Do NOT output anything else — no explanation, no JSON, no markdown.
                """;

        String userMessage = "Question: " + question + "\n\nCandidates:\n" + candList
                + "\nBest index_number (or NONE):";

        try {
            dev.langchain4j.data.message.SystemMessage sysMsg =
                    dev.langchain4j.data.message.SystemMessage.from(systemPrompt);
            dev.langchain4j.data.message.UserMessage userMsg =
                    dev.langchain4j.data.message.UserMessage.from(userMessage);
            dev.langchain4j.model.chat.response.ChatResponse response =
                    indexAskModel.chat(List.of(sysMsg, userMsg));
            String text = response.aiMessage().text().trim();
            // 清理 LLM 可能返回的多余字符
            text = text.replaceAll("^[`'\"]+|[`'\"]+$", "").trim();

            if ("NONE".equalsIgnoreCase(text) || text.isBlank()) {
                log.info("LLM refinement returned NONE for question [{}] with {} candidates",
                        question, candidates.size());
                return Optional.empty();
            }

            // 校验返回值在候选列表中
            final String finalText = text;
            boolean valid = candidates.stream()
                    .anyMatch(e -> finalText.equals(e.getIndexNumber()));
            if (!valid) {
                log.warn("LLM refinement returned invalid index_number [{}], treating as NONE", text);
                return Optional.empty();
            }

            log.info("LLM refinement picked index [{}] from {} candidates for question [{}]",
                    text, candidates.size(), question);
            return Optional.of(text);
        } catch (Exception ex) {
            log.warn("LLM refinement call failed: {}", ex.getMessage());
            return Optional.empty();
        }
    }

    /**
     * 检查精排选中的指标在候选列表中是否存在口径歧义:
     * 同名(去掉口径后缀后相同)但 source 不同 → 存在多条口径变体,
     * 此时不应静默选择,应触发模糊问让用户明确。
     */
    private boolean hasCaliberAmbiguityInCandidates(String pickedIndexNumber,
                                                     List<IndexEntry> candidates) {
        if (pickedIndexNumber == null || candidates == null || candidates.size() <= 1) {
            return false;
        }
        IndexEntry picked = candidates.stream()
                .filter(e -> pickedIndexNumber.equals(e.getIndexNumber()))
                .findFirst().orElse(null);
        if (picked == null || picked.getStandardName() == null) {
            return false;
        }
        String baseName = extractIndexFamilyName(picked.getStandardName());
        Integer pickedSource = picked.getSource();

        return candidates.stream()
                .filter(e -> e.getStandardName() != null)
                .filter(e -> !pickedIndexNumber.equals(e.getIndexNumber()))
                .anyMatch(e -> {
                    String otherBase = extractIndexFamilyName(e.getStandardName());
                    Integer otherSource = e.getSource();
                    return baseName.equals(otherBase)
                            && !Objects.equals(pickedSource, otherSource);
                });
    }

    /**
     * 构建指标模糊问提示消息:将检索到的多个候选指标按族分组展示,
     * 引导用户明确选择具体指标后再查询。
     * <p>族名从 standardName 中提取(去掉括号内的 notes/口径后缀)。
     */
    private String buildAmbiguousIndexMessage(String question,
                                              List<IndexEntry> candidates) {
        StringBuilder sb = new StringBuilder();
        sb.append("您好，BeCause已经看到了您的查询，怕理解有偏差，给您整理了几个比较贴近的指标，请选择以下指标名称，明确指标：\n");

        for (IndexEntry e : candidates) {
            String name = e.getStandardName();
            if (name == null || name.isBlank()) continue;
            sb.append(name).append("\n");
        }
        return sb.toString().trim();
    }

    /**
     * 从标准指标名中提取族名:去掉口径后缀和括号内的 notes,取基础名。
     */
    private static String extractIndexFamilyName(String standardName) {
        if (standardName == null) {
            return "";
        }
        String normalized = standardName
                .replace('（', '(')
                .replace('）', ')')
                .replaceAll("\\([^)]*口径\\)", "")
                .replaceAll("人行口径|监管口径|银监口径|省联社口径", "")
                .trim();
        int parenIdx = normalized.indexOf('(');
        if (parenIdx > 0) {
            return normalized.substring(0, parenIdx).trim();
        }
        return normalized;
    }

    /**
     * 把 {@link IndexCaliberGroup} 列表序列化成 SIMILAR_QUESTION_EVENT 携带的 List<Map>,
     * 字段命名与前端事件契约一致(snake_case)。
     */
    private static List<Map<String, Object>> serializeCaliberGroups(List<IndexCaliberGroup> groups) {
        List<Map<String, Object>> out = new ArrayList<>(groups.size());
        for (IndexCaliberGroup g : groups) {
            List<Map<String, Object>> entries = new ArrayList<>(g.getEntries().size());
            for (IndexEntry e : g.getEntries()) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("index_number", e.getIndexNumber());
                entry.put("standard_name", e.getStandardName());
                entry.put("aliases", e.getAliases());
                entry.put("source", e.getSource());
                entry.put("frequency", e.getFrequency());
                entries.add(entry);
            }
            Map<String, Object> group = new LinkedHashMap<>();
            group.put("standard_name", g.getStandardName());
            group.put("entries", entries);
            out.add(group);
        }
        return out;
    }

    /**
     * 把"召回但 LLM 未选中"的指标条目序列化成 SIMILAR_QUESTION_EVENT 的 similar_indices 字段。
     * 字段命名与前端事件契约一致(snake_case)。
     */
    private static List<Map<String, Object>> serializeIndexEntries(List<IndexEntry> entries) {
        List<Map<String, Object>> out = new ArrayList<>(entries.size());
        for (IndexEntry e : entries) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("index_number", e.getIndexNumber());
            entry.put("standard_name", e.getStandardName());
            entry.put("aliases", e.getAliases());
            entry.put("source", e.getSource());
            entry.put("frequency", e.getFrequency());
            out.add(entry);
        }
        return out;
    }

    /**
     * 把 LLM 返回的 index_number 字符串列表转为 [{index_number, standard_name}, ...],
     * standard_name 从 indexContext 候选中查找;找不到时仅填 index_number。
     */
    private static List<Map<String, Object>> toSelectedIndexMaps(
            List<String> indexNumbers, IndexContext indexContext) {
        Map<String, String> numberToName = Collections.emptyMap();
        if (indexContext != null && indexContext.getIndexCandidates() != null) {
            numberToName = indexContext.getIndexCandidates().stream()
                    .collect(Collectors.toMap(
                            IndexEntry::getIndexNumber,
                            IndexEntry::getStandardName,
                            (a, b) -> a));
        }
        List<Map<String, Object>> out = new ArrayList<>(indexNumbers.size());
        for (String num : indexNumbers) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("index_number", num);
            entry.put("standard_name", numberToName.getOrDefault(num, null));
            out.add(entry);
        }
        return out;
    }
}
