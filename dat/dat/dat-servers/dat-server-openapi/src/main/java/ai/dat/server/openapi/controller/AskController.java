package ai.dat.server.openapi.controller;

import ai.dat.boot.utils.QuestionSqlPairCacheUtil;
import ai.dat.core.agent.DefaultAskdataAgent;
import ai.dat.core.agent.data.StreamAction;
import ai.dat.core.agent.data.StreamEvent;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.QuestionSqlPair;
import ai.dat.core.index.data.IndexContext;
import ai.dat.core.index.resolver.IndexContextResolver;
import ai.dat.server.openapi.config.ServerConfig;
import ai.dat.server.openapi.dto.AskRequest;
import ai.dat.server.openapi.dto.AskUserApproval;
import ai.dat.server.openapi.dto.AskUserResponse;
import ai.dat.server.openapi.service.ProjectService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@Slf4j
@RestController
@RequestMapping("/api/v1/ask")
@Tag(name = "Ask data", description = "Ask data API based on natural language")
public class AskController {

    // ------------------------------ Event name ------------------------------------
    private static final String PING_EVENT = "ping";
    private static final String INTENT_CLASSIFICATION_EVENT = "intent_classification";
    private static final String SQL_GENERATE_EVENT = "sql_generate";
    private static final String SQL_EXECUTE_EVENT = "sql_execute";
    private static final String AGENT_ANSWER_EVENT = "agent_answer";
    private static final String SOURCE_EVENT = "source";
    private static final String AGENT_ANSWER_END_EVENT = "agent_answer_end";
    private static final String MISLEADING_ASSISTANCE_EVENT = "misleading_assistance";
    private static final String DATA_ASSISTANCE_EVENT = "data_assistance";
    private static final String SQL_GENERATION_REASONING_EVENT = "sql_generation_reasoning";
    private static final String BEFORE_TOOL_EXECUTION_EVENT = "before_tool_execution";
    private static final String TOOL_EXECUTION_EVENT = "tool_execution";
    private static final String HITL_AI_REQUEST_EVENT = "hitl_ai_request";
    private static final String HITL_TOOL_APPROVAL_EVENT = "hitl_tool_approval";
    private static final String SIMILAR_QUESTION_EVENT = "similar_question";
    private static final String OTHER_EVENT = "other";
    private static final String ERROR_EVENT = "error";
    private static final String FINISHED_EVENT = "finished";

    // ------------------------------ Parameter key ------------------------------------
    private static final String CONVERSATION_ID = "conversation_id";
    private static final String TIMESTAMP = "timestamp";
    private static final String SEMANTIC_SQL = "semantic_sql";
    private static final String QUERY_SQL = "query_sql";
    private static final String QUERY_DATA = "query_data";
    private static final String ANSWER = "answer";
    private static final String ANSWER_ID = "answer_id";
    private static final String TOOL_ID = "tool_id";
    private static final String TOOL_NAME = "tool_name";
    private static final String TOOL_ARGUMENTS = "tool_arguments";
    private static final String TOOL_RESULT = "tool_result";
    private static final String AI_REQUEST = "ai_request";
    private static final String TOOL_APPROVAL = "tool_approval";
    private static final String WAIT_TIMEOUT = "wait_timeout";
    private static final String ERROR = "error";
    private static final String STATUS = "status";
    private static final String SUB_EVENT = "sub_event";

    // ------------------------------ Parameter value ------------------------------------
    private static final String STATUS_SUCCESS = "succeeded";
    private static final String STATUS_FAILURE = "failed";

    final ProjectService runnerService;
    private final ServerConfig serverConfig;
    private final IndexContextResolver indexContextResolver;
    private final ai.dat.project.datastore.service.GlobalConfigService globalConfigService;
    @Autowired(required = false)
    private ai.dat.core.index.bm25.IndexBm25Index bm25Index;

    @Autowired
    public AskController(ProjectService runnerService,
                          ServerConfig serverConfig,
                          @Autowired(required = false) IndexContextResolver indexContextResolver,
                          @Autowired(required = false) ai.dat.project.datastore.service.GlobalConfigService globalConfigService) {
        this.runnerService = runnerService;
        this.serverConfig = serverConfig;
        this.indexContextResolver = indexContextResolver;
        this.globalConfigService = globalConfigService;
        log.info("AskController initialized, indexContextResolver={}, globalConfigService={}",
                indexContextResolver != null ? "present" : "null",
                globalConfigService != null ? "present" : "null");
    }

    // 用于定时发送ping事件的线程池
    private final ScheduledExecutorService pingScheduler = Executors.newScheduledThreadPool(1);

    // 用于处理SSE流式响应的线程池
    private final ExecutorService streamExecutor = Executors.newCachedThreadPool(new ThreadFactory() {
        private final AtomicInteger threadNumber = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable r) {
            Thread thread = new Thread(r, "sse-stream-processor-" + threadNumber.getAndIncrement());
            thread.setDaemon(false);
            return thread;
        }
    });

    private static final String NOT_GENERATE = "<not generate>";

    @Operation(summary = "Ask data (Streaming)",
            description = "Ask data using natural language and return the SSE (Server-Sent Events) stream")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Successful",
                    content = @Content(mediaType = "text/event-stream",
                            examples = {
                                    @ExampleObject(name = PING_EVENT,
                                            summary = "Ping event",
                                            description = "Ping event every 10 seconds to keep the connection alive.",
                                            value = "event: " + PING_EVENT + "\n" +
                                                    "data: {\"" + TIMESTAMP + "\":1756051200000,\""
                                                    + CONVERSATION_ID + ":\"<id>\"}\n\n"),
                                    @ExampleObject(name = SQL_GENERATE_EVENT,
                                            summary = "SQL generation event",
                                            description = "The generated SQL statement (" + SEMANTIC_SQL + ")",
                                            value = "event: " + SQL_GENERATE_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + SEMANTIC_SQL + "\":\"SELECT * FROM orders WHERE ...\"}\n\n"),
                                    @ExampleObject(name = SOURCE_EVENT,
                                            summary = "Table sources event",
                                            description = "The tables selected as sources for the query",
                                            value = "event: " + SOURCE_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + "tables\":[\"table1\", \"table2\"]}\n\n"),
                                    @ExampleObject(name = SQL_EXECUTE_EVENT,
                                            summary = "SQL execution result event",
                                            description = "Query result data (" + QUERY_DATA + ")",
                                            value = "event: " + SQL_EXECUTE_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + QUERY_DATA + "\":[{\"order_id\":1,\"amount\":100.0}]}\n\n"),
                                    @ExampleObject(name = AGENT_ANSWER_EVENT,
                                            summary = "Agent incremental answer event",
                                            description = "Returned text chunk content (" + ANSWER + ")",
                                            value = "event: " + AGENT_ANSWER_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + ANSWER_ID + "\":\"<id>\",\""
                                                    + ANSWER + "\":\"We are analyzing the data for you ...\"}\n\n"),
                                    @ExampleObject(name = AGENT_ANSWER_END_EVENT,
                                            summary = "Agent incremental answer end event",
                                            description = "Receiving this event means agent incremental answer streaming has ended.",
                                            value = "event: " + AGENT_ANSWER_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + ANSWER_ID + "\":\"<id>\",\""
                                                    + ANSWER + "\":\"We are analyzing the data for you ...\"}\n\n"),
                                    @ExampleObject(name = BEFORE_TOOL_EXECUTION_EVENT,
                                            summary = "Before tool execution event",
                                            description = "Before tool execution request",
                                            value = "event: " + BEFORE_TOOL_EXECUTION_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + TOOL_ID + "\":\"<id>\",\""
                                                    + TOOL_NAME + "\":\"<name>\",\""
                                                    + TOOL_ARGUMENTS + "\":\"<arguments>\"}\n\n"),
                                    @ExampleObject(name = TOOL_EXECUTION_EVENT,
                                            summary = "Tool execution event",
                                            description = "Tool execution request and result",
                                            value = "event: " + TOOL_EXECUTION_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + TOOL_ID + "\":\"<id>\",\""
                                                    + TOOL_NAME + "\":\"<name>\",\""
                                                    + TOOL_ARGUMENTS + "\":\"<arguments>\",\""
                                                    + TOOL_RESULT + "\":\"<result>\"}\n\n"),
                                    @ExampleObject(name = HITL_AI_REQUEST_EVENT,
                                            summary = "Human-in-the-loop AI request event",
                                            description = "Requests that require additional input from the user (" + AI_REQUEST + "). " +
                                                    "Human-in-the-loop waiting timeout time seconds (" + WAIT_TIMEOUT + " [optional]).",
                                            value = "event: " + HITL_AI_REQUEST_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + AI_REQUEST + "\":\"Please provide the time range for screening\",\""
                                                    + WAIT_TIMEOUT + "\":30}\n\n"),
                                    @ExampleObject(name = HITL_TOOL_APPROVAL_EVENT,
                                            summary = "Human-in-the-loop tool approval event",
                                            description = "Requests that tool approval from the user (" + TOOL_APPROVAL + "). " +
                                                    "Human-in-the-loop waiting timeout time seconds (" + WAIT_TIMEOUT + " [optional]).",
                                            value = "event: " + HITL_TOOL_APPROVAL_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + TOOL_APPROVAL + "\":\"Is it allowed to perform the operation of sending emails?\",\""
                                                    + WAIT_TIMEOUT + "\":30}\n\n"),
                                    @ExampleObject(name = SIMILAR_QUESTION_EVENT,
                                            summary = "Similar question event (index ask multi-caliber)",
                                            description = "Fired when an index name (e.g. '各项存款余额') maps to multiple " +
                                                    "calibers (人行 / 银监 / 省联社 ...). Frontend should render as " +
                                                    "'You may also ask: XX caliber'.",
                                            value = "event: " + SIMILAR_QUESTION_EVENT + "\n" +
                                                    "data: {\"" + CONVERSATION_ID + "\":\"<id>\",\""
                                                    + TIMESTAMP + "\":1756051200000," +
                                                    "\"caliber_groups\":[{\"standard_name\":\"各项存款余额\"," +
                                                    "\"entries\":[{\"index_number\":\"KPI0001\",\"source\":1}," +
                                                    "{\"index_number\":\"KPI0001_CBRC\",\"source\":2}]}]}\n\n"),
                                    @ExampleObject(name = ERROR_EVENT,
                                            summary = "Error event",
                                            description = "Exceptions that occur during the streaming process " +
                                                    "will be output in the form of stream events",
                                            value = "event: " + ERROR_EVENT + "\n" +
                                                    "data: {\"" + ERROR + "\":\"Stream processing failed: ...\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + CONVERSATION_ID + "\":\"<id>\"}\n\n"),
                                    @ExampleObject(name = FINISHED_EVENT,
                                            summary = "Finished event",
                                            description = "execution ends, succeeded or failed in different states in the same event",
                                            value = "event: " + FINISHED_EVENT + "\n" +
                                                    "data: {\"" + STATUS + ":\"succeeded\",\""
                                                    + TIMESTAMP + "\":1756051200000,\""
                                                    + CONVERSATION_ID + "\":\"<id>\"}\n\n"),
                                    @ExampleObject(name = OTHER_EVENT,
                                            summary = "Other event",
                                            description = "Other supplementary message.",
                                            value = "event: " + OTHER_EVENT + "\n" +
                                                    "data: {\"" + SUB_EVENT + "\":\"<sub_event>\",\""
                                                    + TIMESTAMP + "\":1756051200000," +
                                                    "\"" + CONVERSATION_ID + "\":\"<id>\", ...}\n\n")
                            }
                    )),
            @ApiResponse(responseCode = "400", description = "Request parameter error"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter askStream(@Valid @RequestBody AskRequest request,
                                @org.springframework.web.bind.annotation.RequestHeader(value = "X-User-Id", required = false) String userId,
                                @org.springframework.web.bind.annotation.RequestHeader(value = "X-Agent-Id", required = false) String agentId) {
        String conversationId = request.getConversationId() == null || request.getConversationId().isBlank() ?
                UUID.randomUUID().toString() : request.getConversationId();

        List<QuestionSqlPair> histories = QuestionSqlPairCacheUtil.get(conversationId);

        SseEmitter emitter = new SseEmitter(5 * 60 * 1000L); // 5 minutes timeout

        // 解析 IndexContext(Resolver 不存在或召回为空时返回 disabled,DefaultAskdataAgent 自然跳过)
        Map<String, Object> attributes = buildRequestAttributes(request);

        // 使用 AtomicReference 确保线程安全
        AtomicReference<ScheduledFuture<?>> pingTaskRef = new AtomicReference<>();

        // 启动定时ping任务，每10秒发送一次ping事件
        ScheduledFuture<?> pingTask = pingScheduler.scheduleAtFixedRate(() -> {
            try {
                emitter.send(SseEmitter.event()
                        .name(PING_EVENT)
                        .data(Map.of(TIMESTAMP, System.currentTimeMillis(),
                                CONVERSATION_ID, conversationId)));
            } catch (Exception e) {
                log.debug("Failed to send ping event for request [{}]: {}", conversationId, e.getMessage());
                // ping失败通常表示连接已断开，取消任务
                ScheduledFuture<?> task = pingTaskRef.get();
                if (task != null) {
                    task.cancel(false);
                }
            }
        }, 0, 10, TimeUnit.SECONDS);

        pingTaskRef.set(pingTask);

        // 使用线程池异步处理流式响应
        streamExecutor.execute(() -> processStreamEvents(
                emitter,
                conversationId,
                request,
                histories,
                pingTask,
                userId,
                agentId,
                attributes));

        // 回调中也取消 ping 任务（作为额外保障）
        Runnable cancelPing = () -> {
            ScheduledFuture<?> task = pingTaskRef.get();
            if (task != null && !task.isCancelled()) {
                task.cancel(false);
            }
        };

        emitter.onCompletion(cancelPing); // 添加完成回调，确保ping任务被取消
        emitter.onTimeout(cancelPing); // 添加超时回调，确保ping任务被取消
        emitter.onError((ex) -> cancelPing.run()); // 添加错误回调，确保ping任务被取消

        return emitter;
    }

    /**
     * 处理流式事件
     */
    private void processStreamEvents(SseEmitter emitter, String conversationId,
                                     AskRequest request, List<QuestionSqlPair> histories,
                                     ScheduledFuture<?> pingTask,
                                     String userId,
                                     String agentId,
                                     Map<String, Object> attributes) {
        String sql = NOT_GENERATE;
        boolean isAccurateSql = false;
        Exception caughtException = null;

        try {
            StreamAction action = runnerService.ask(conversationId,
                    request.getProjectId(), request.getDatasourceId(),
                    request.getAgentName(), request.getQuestion(), histories,
                    userId, agentId, attributes);

            String previousEvent = "";
            boolean previousIncremental = false;
            String eventId = null;

            // 处理流式事件
            for (StreamEvent event : action) {
                if (event == null) break;

                if (event.getSemanticSql().isPresent()) {
                    sql = event.getSemanticSql().get();
                }
                if (event.getQueryData().isPresent()) {
                    isAccurateSql = true;
                }

                String eventName = event.name();
                if (!previousEvent.equals(eventName)) {
                    if (previousIncremental) {
                        sendAgentAnswerEndEvent(emitter, eventId, conversationId);
                    }
                    previousEvent = eventName;
                    previousIncremental = event.getIncrementalContent().isPresent();
                    eventId = UUID.randomUUID().toString();
                }

                // 转换并发送事件
                sendStreamEvent(emitter, event, eventId, conversationId);

                // 如果有错误，发送错误事件并结束
                if (hasError(event)) {
                    sendErrorEvent(emitter, conversationId, getErrorMessage(event));
                    break;
                }
            }

            if (previousIncremental) {
                sendAgentAnswerEndEvent(emitter, eventId, conversationId);
            }

            // 发送完成事件
            sendFinishedEvent(emitter, conversationId, STATUS_SUCCESS, null);
            log.info("Stream ask data request completed [{}]", conversationId);
        } catch (Exception e) {
            caughtException = e;
            log.error("Error during stream processing [{}]: {}", conversationId, e.getMessage(), e);
            try {
                sendErrorEvent(emitter, conversationId, e.getMessage());
                sendFinishedEvent(emitter, conversationId, STATUS_FAILURE, e.getMessage());
            } catch (IOException ex) {
                log.error("Error sending error event: {}", ex.getMessage());
            }
        } finally {
            // 添加历史记录
            if (!isAccurateSql && !NOT_GENERATE.equals(sql)) {
                sql = "/* Incorrect SQL */ " + sql;
            }
            QuestionSqlPairCacheUtil.add(conversationId, QuestionSqlPair.from(request.getQuestion(), sql));

            // 确保 ping 任务被取消（在 complete 之前，避免竞态条件）
            if (!pingTask.isCancelled()) {
                pingTask.cancel(false);
            }

            // 统一在 finally 中完成 emitter，确保无论如何都会被关闭
            try {
                if (caughtException != null) {
                    emitter.completeWithError(caughtException);
                } else {
                    emitter.complete();
                }
            } catch (Exception e) {
                log.error("Error completing emitter for [{}]: {}", conversationId, e.getMessage());
            }
        }
    }

    /**
     * 发送流事件
     */
    private void sendStreamEvent(SseEmitter emitter, StreamEvent event,
                                 String eventId, String conversationId) throws IOException {
        String name = event.name();
        AtomicReference<String> eventName = new AtomicReference<>(OTHER_EVENT);
        Map<String, Object> eventData = new HashMap<>();
        eventData.put(CONVERSATION_ID, conversationId);
        eventData.put(TIMESTAMP, System.currentTimeMillis());

        // 优先根据事件名称映射特定的 SSE 事件
        if ("intent_classification".equals(name)) {
            eventName.set(INTENT_CLASSIFICATION_EVENT);
        } else if ("source".equals(name)) {
            eventName.set(SOURCE_EVENT);
        } else if ("sql_generation_reasoning".equals(name)) {
            eventName.set(SQL_GENERATION_REASONING_EVENT);
        } else if ("misleading_assistance".equals(name)) {
            // 如果用户希望这些也放到思维链，则使用独立事件
            eventName.set(MISLEADING_ASSISTANCE_EVENT);
        } else if ("data_assistance".equals(name)) {
            eventName.set(DATA_ASSISTANCE_EVENT);
        } else if ("similar_question".equals(name)) {
            // 指标问数多口径相似问:caliber_groups 在 event.getMessages() 里,
            // 下方 eventData.putAll(messages) 会自动合并到 SSE data 字段
            eventName.set(SIMILAR_QUESTION_EVENT);
        }

        // 如果还没有映射，且包含增量内容，默认为 agent_answer
        if (OTHER_EVENT.equals(eventName.get())) {
            event.getIncrementalContent().ifPresent(content -> {
                eventName.set(AGENT_ANSWER_EVENT);
                eventData.put(ANSWER_ID, eventId);
                eventData.put(ANSWER, content);
            });
            event.getSemanticSql().ifPresent(semanticSql -> {
                eventName.set(SQL_GENERATE_EVENT);
                eventData.put(SEMANTIC_SQL, semanticSql);
            });
            event.getQueryData().ifPresent(data -> {
                eventName.set(SQL_EXECUTE_EVENT);
                eventData.put(QUERY_DATA, data);
            });
        } else {
            // 对于已映射的特定业务事件 (如 intent_classification, sql_generation_reasoning)
            // 提取其中的增量内容 (content) 或其他字段
            event.getIncrementalContent().ifPresent(content -> {
                eventData.put("content", content);
            });
            // 确保 messages 中的字段也合并进去 (如 intent_classification 的 intent, reasoning 等)
        }

        if (event.getToolExecutionResult().isEmpty()) {
            event.getToolExecutionRequest().ifPresent(request -> {
                eventName.set(BEFORE_TOOL_EXECUTION_EVENT);
                eventData.put(TOOL_ID, request.id());
                eventData.put(TOOL_NAME, request.name());
                eventData.put(TOOL_ARGUMENTS, request.arguments());
            });
        }
        event.getToolExecutionResult().ifPresent(result -> {
            eventName.set(TOOL_EXECUTION_EVENT);
            event.getToolExecutionRequest().ifPresent(request -> {
                eventData.put(TOOL_ID, request.id());
                eventData.put(TOOL_NAME, request.name());
                eventData.put(TOOL_ARGUMENTS, request.arguments());
            });
            eventData.put(TOOL_RESULT, result);
        });
        event.getHitlAiRequest().ifPresent(aiRequest -> {
            eventName.set(HITL_AI_REQUEST_EVENT);
            eventData.put(AI_REQUEST, aiRequest);
            event.getHitlWaitTimeout().ifPresent(timeout -> eventData.put(WAIT_TIMEOUT, timeout));
        });
        event.getHitlToolApproval().ifPresent(approval -> {
            eventName.set(HITL_TOOL_APPROVAL_EVENT);
            eventData.put(TOOL_APPROVAL, approval);
            event.getHitlWaitTimeout().ifPresent(timeout -> eventData.put(WAIT_TIMEOUT, timeout));
        });

        Map<String, Object> messages = event.getMessages();
        if (OTHER_EVENT.equals(eventName.get())) {
            eventData.put(SUB_EVENT, event.name());
        }
        eventData.putAll(messages);

        emitter.send(SseEmitter.event().name(eventName.get()).data(eventData));
    }

    /**
     * 发送代理回答结束事件
     */
    private void sendAgentAnswerEndEvent(SseEmitter emitter, String answerId, String conversationId) throws IOException {
        emitter.send(SseEmitter.event()
                .name(AGENT_ANSWER_END_EVENT)
                .data(Map.of(ANSWER_ID, answerId,
                        TIMESTAMP, System.currentTimeMillis(),
                        CONVERSATION_ID, conversationId)));
    }

    /**
     * 发送错误事件
     */
    private void sendErrorEvent(SseEmitter emitter, String conversationId, String errorMsg) throws IOException {
        emitter.send(SseEmitter.event()
                .name(ERROR_EVENT)
                .data(Map.of(ERROR, errorMsg,
                        TIMESTAMP, System.currentTimeMillis(),
                        CONVERSATION_ID, conversationId)));
    }

    /**
     * 发送完成事件
     */
    private void sendFinishedEvent(SseEmitter emitter, String conversationId,
                                   String status, String error) throws IOException {
        Map<String, Object> data = new HashMap<>();
        data.put(STATUS, status);
        data.put(TIMESTAMP, System.currentTimeMillis());
        data.put(CONVERSATION_ID, conversationId);
        if (error != null) {
            data.put(ERROR, error);
        }
        emitter.send(SseEmitter.event().name(FINISHED_EVENT).data(data));
    }

    /**
     * 检查事件中是否有错误
     */
    private boolean hasError(StreamEvent event) {
        Map<String, Object> messages = event.getMessages();
        return messages.containsKey("error") || messages.containsKey("exception");
    }

    /**
     * 从事件中获取错误消息
     */
    private String getErrorMessage(StreamEvent event) {
        Map<String, Object> messages = event.getMessages();
        Object errorMsg = messages.get("error");
        if (errorMsg == null) {
            errorMsg = messages.get("exception");
        }
        return errorMsg != null ? errorMsg.toString() : "Unknown error";
    }

    /**
     * 填充默认项目和数据源配置。
     * <p>当请求中未提供 project_id 或 datasource_id 时，从数据库读取默认值。
     * 适用于单项目部署场景，简化客户端调用。
     */
    void applyDefaultProjectAndDatasource(AskRequest request) {
        if (globalConfigService == null) {
            return;
        }

        try {
            ai.dat.project.datastore.document.GlobalConfigDocument config = globalConfigService.getGlobalConfig();

            if ((request.getProjectId() == null || request.getProjectId().isBlank())
                    && config.getDefaultProjectId() != null
                    && !config.getDefaultProjectId().isBlank()) {
                request.setProjectId(config.getDefaultProjectId());
                log.debug("Applied default project_id from database: {}", config.getDefaultProjectId());
            }

            if ((request.getDatasourceId() == null || request.getDatasourceId().isBlank())
                    && config.getDefaultDatasourceId() != null
                    && !config.getDefaultDatasourceId().isBlank()) {
                request.setDatasourceId(config.getDefaultDatasourceId());
                log.debug("Applied default datasource_id from database: {}", config.getDefaultDatasourceId());
            }
        } catch (Exception e) {
            log.warn("Failed to apply default config from database: {}", e.getMessage());
        }
    }

    /**
     * 从请求构造透传给 Agent 的 attributes Map。
     * <p>包含 IndexContext(若 Resolver 可用且能拿到 ContentStore)。
     * Resolver 不存在时返回空 Map,DefaultAskdataAgent 会自然跳过 INDEX QUERY CONSTRAINTS 注入。
     */
    Map<String, Object> buildRequestAttributes(AskRequest request) {
        if (indexContextResolver == null
                || request.getProjectId() == null || request.getProjectId().isBlank()) {
            return Collections.emptyMap();
        }
        try {
            // 拿 ContentStore 给 Resolver 走向量召回。失败时 Resolver 内部 safeRetrieve 会降级
            ContentStore contentStore = null;
            try {
                contentStore = runnerService.getProjectRunner(request.getProjectId(), request.getDatasourceId())
                        .getContentStore();
            } catch (Exception ex) {
                log.warn("Failed to get ContentStore for index context, vector recall will be skipped: {}",
                        ex.getMessage());
            }
            IndexContext ctx = indexContextResolver.resolve(contentStore,
                    request.getProjectId(), request.getQuestion(),
                    request.getOrgCode());
            if (bm25Index != null) {
                return Map.of(
                        DefaultAskdataAgent.ATTR_INDEX_CONTEXT, ctx,
                        DefaultAskdataAgent.ATTR_BM25_INDEX, bm25Index);
            }
            return Map.of(DefaultAskdataAgent.ATTR_INDEX_CONTEXT, ctx);
        } catch (Exception e) {
            log.warn("IndexContextResolver failed, falling back to generic ask: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    @Operation(summary = "Ask data (Non-streaming)",
            description = "Ask data using natural language and return a single aggregated JSON response. " +
                    "Aggregates all underlying stream events (incremental answer, semantic SQL, query result, " +
                    "tool executions, similar questions, etc.) into one response. " +
                    "Note: this endpoint does not support human-in-the-loop interaction; if HITL is required " +
                    "during processing, the request will wait until the corresponding user response/approval " +
                    "is provided via the /user-response or /user-approval endpoints (using the returned " +
                    "conversation_id), or until the timeout is reached.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Successful"),
            @ApiResponse(responseCode = "400", description = "Request parameter error"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @PostMapping(value = "", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> ask(@Valid @RequestBody AskRequest request,
                                                   @org.springframework.web.bind.annotation.RequestHeader(value = "X-User-Id", required = false) String userId,
                                                   @org.springframework.web.bind.annotation.RequestHeader(value = "X-Agent-Id", required = false) String agentId) {
        String conversationId = request.getConversationId() == null || request.getConversationId().isBlank() ?
                UUID.randomUUID().toString() : request.getConversationId();

        AggregatedAskResult result = runAskAggregated(request, conversationId, userId, agentId);
        if (result.fatalException != null) {
            return ResponseEntity.internalServerError().body(result.body);
        }
        return ResponseEntity.ok(result.body);
    }

    /**
     * 聚合执行问数,把所有 StreamEvent 拼成一份 JSON map。
     * <p>抽出来供 {@code /api/v1/ask} (纯 JSON) 与 ESB 适配的 {@link EsbAskController} 复用。
     * 包私有可见性 —— 仅同包内的 Controller 可调用。
     */
    AggregatedAskResult runAskAggregated(AskRequest request, String conversationId,
                                         String userId, String agentId) {
        // 填充默认项目和数据源
        applyDefaultProjectAndDatasource(request);

        List<QuestionSqlPair> histories = QuestionSqlPairCacheUtil.get(conversationId);
        Map<String, Object> attributes = buildRequestAttributes(request);

        Map<String, Object> response = new java.util.LinkedHashMap<>();
        response.put(CONVERSATION_ID, conversationId);
        response.put(TIMESTAMP, System.currentTimeMillis());

        String sql = NOT_GENERATE;
        boolean isAccurateSql = false;
        StringBuilder answerBuffer = new StringBuilder();
        List<Map<String, Object>> toolExecutions = new java.util.ArrayList<>();
        AggregatedAskResult result = new AggregatedAskResult();
        result.body = response;

        try {
            StreamAction action = runnerService.ask(conversationId,
                    request.getProjectId(), request.getDatasourceId(),
                    request.getAgentName(), request.getQuestion(), histories,
                    userId, agentId, attributes);

            String streamError = null;
            for (StreamEvent event : action) {
                if (event == null) break;

                event.getSemanticSql().ifPresent(s -> response.put(SEMANTIC_SQL, s));
                event.getQuerySql().ifPresent(s -> response.put(QUERY_SQL, s));
                if (event.getSemanticSql().isPresent()) {
                    sql = event.getSemanticSql().get();
                }
                if (event.getQueryData().isPresent()) {
                    isAccurateSql = true;
                    response.put(QUERY_DATA, event.getQueryData().get());
                }

                // 累加 agent_answer 的增量内容；其它分类事件(intent_classification 等)
                // 的 incremental 通过 messages 里的 content 字段返回，不进入最终 answer。
                if (event.getIncrementalContent().isPresent()
                        && event.getSemanticSql().isEmpty()
                        && event.getQueryData().isEmpty()
                        && isPlainAnswerEvent(event.name())) {
                    answerBuffer.append(event.getIncrementalContent().get());
                }

                event.getToolExecutionResult().ifPresent(execResult -> {
                    Map<String, Object> exec = new HashMap<>();
                    event.getToolExecutionRequest().ifPresent(req -> {
                        exec.put(TOOL_ID, req.id());
                        exec.put(TOOL_NAME, req.name());
                        exec.put(TOOL_ARGUMENTS, req.arguments());
                    });
                    exec.put(TOOL_RESULT, execResult);
                    toolExecutions.add(exec);
                });

                // 合并业务事件的其它消息(intent_classification、source.tables、
                // similar_question.caliber_groups、misleading_assistance 等)。
                String name = event.name();
                Map<String, Object> messages = event.getMessages();
                if (!messages.isEmpty()) {
                    if ("intent_classification".equals(name)) {
                        mergeNamespacedMessages(response, "intent_classification", messages);
                    } else if ("source".equals(name)) {
                        messages.forEach(response::put);
                    } else if ("similar_question".equals(name)) {
                        messages.forEach(response::put);
                    } else if ("misleading_assistance".equals(name)) {
                        mergeNamespacedMessages(response, "misleading_assistance", messages);
                    } else if ("data_assistance".equals(name)) {
                        mergeNamespacedMessages(response, "data_assistance", messages);
                    } else if ("sql_generation_reasoning".equals(name)) {
                        mergeNamespacedMessages(response, "sql_generation_reasoning", messages);
                    }
                }

                if (hasError(event)) {
                    streamError = getErrorMessage(event);
                    break;
                }
            }

            if (!toolExecutions.isEmpty()) {
                response.put("tool_executions", toolExecutions);
            }
            if (answerBuffer.length() > 0) {
                response.put(ANSWER, answerBuffer.toString());
            }

            if (streamError != null) {
                response.put(STATUS, STATUS_FAILURE);
                response.put(ERROR, streamError);
                result.businessError = streamError;
                log.info("Non-stream ask data request finished with error [{}]: {}", conversationId, streamError);
            } else {
                response.put(STATUS, STATUS_SUCCESS);
                log.info("Non-stream ask data request completed [{}]", conversationId);
            }
        } catch (Exception e) {
            log.error("Error during non-stream processing [{}]: {}", conversationId, e.getMessage(), e);
            response.put(STATUS, STATUS_FAILURE);
            response.put(ERROR, e.getMessage());
            result.fatalException = e;
        } finally {
            if (!isAccurateSql && !NOT_GENERATE.equals(sql)) {
                sql = "/* Incorrect SQL */ " + sql;
            }
            QuestionSqlPairCacheUtil.add(conversationId, QuestionSqlPair.from(request.getQuestion(), sql));
        }
        return result;
    }

    /** 聚合问数结果。{@code body} 永远非空;{@code businessError}/{@code fatalException} 表示失败种类。 */
    static class AggregatedAskResult {
        Map<String, Object> body;
        String businessError;
        Exception fatalException;
    }

    /**
     * 判断当前事件名是否为纯 agent_answer 类增量事件
     * (不是 intent_classification / sql_generation_reasoning 等命名分类事件)
     */
    private boolean isPlainAnswerEvent(String name) {
        return !"intent_classification".equals(name)
                && !"source".equals(name)
                && !"sql_generation_reasoning".equals(name)
                && !"misleading_assistance".equals(name)
                && !"data_assistance".equals(name)
                && !"similar_question".equals(name);
    }

    /**
     * 将事件的 messages 以命名空间合并进响应,避免不同事件的同名字段相互覆盖
     */
    private void mergeNamespacedMessages(Map<String, Object> response, String namespace,
                                         Map<String, Object> messages) {
        @SuppressWarnings("unchecked")
        Map<String, Object> bucket = (Map<String, Object>) response.computeIfAbsent(
                namespace, k -> new HashMap<String, Object>());
        bucket.putAll(messages);
    }

    @Operation(summary = "User response",
            description = "Handle the user's response to AI request")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Successful"),
            @ApiResponse(responseCode = "400", description = "Request parameter error"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @PostMapping("/user-response")
    public ResponseEntity<Map<String, String>> userResponse(
            @Valid @RequestBody AskUserResponse response) {
        try {
            runnerService.userResponse(response.getConversationId(), response.getUserResponse());
            return ResponseEntity.ok(Map.of("status", "success",
                    "message", "User response received"));
        } catch (Exception e) {
            log.error("Error processing user response: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("status", "error", "message", e.getMessage()));
        }
    }

    @Operation(summary = "User approval",
            description = "Handle the user's approval for tool call")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Successful"),
            @ApiResponse(responseCode = "400", description = "Request parameter error"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @PostMapping("/user-approval")
    public ResponseEntity<Map<String, String>> userApproval(
            @Valid @RequestBody AskUserApproval approval) {
        try {
            runnerService.userApproval(approval.getConversationId(), approval.getUserApproval());
            return ResponseEntity.ok(Map.of("status", "success",
                    "message", "User approval received"));
        } catch (Exception e) {
            log.error("Error processing user approval: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("status", "error", "message", e.getMessage()));
        }
    }
}
