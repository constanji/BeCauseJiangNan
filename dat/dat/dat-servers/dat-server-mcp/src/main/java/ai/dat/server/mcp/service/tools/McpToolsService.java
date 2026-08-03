package ai.dat.server.mcp.service.tools;

import ai.dat.boot.utils.QuestionSqlPairCacheUtil;
import ai.dat.core.agent.DefaultAskdataAgent;
import ai.dat.core.agent.data.StreamAction;
import ai.dat.core.agent.data.StreamEvent;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.QuestionSqlPair;
import ai.dat.core.index.data.IndexContext;
import ai.dat.core.index.resolver.IndexContextResolver;
import ai.dat.server.mcp.config.ServerConfig;
import ai.dat.server.mcp.service.ProjectService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * @Author JunjieM
 * @Date 2025/9/8
 */
@Slf4j
@Service
public class McpToolsService {

    private static final String NOT_GENERATE = "<not generate>";

    private final static ObjectMapper JSON_MAPPER = new ObjectMapper().findAndRegisterModules();

    private final ProjectService runnerService;
    private final ServerConfig serverConfig;
    private final IndexContextResolver indexContextResolver;
    private final ai.dat.project.datastore.service.GlobalConfigService globalConfigService;

    @Autowired
    public McpToolsService(ProjectService runnerService,
                           ServerConfig serverConfig,
                           @Autowired(required = false) IndexContextResolver indexContextResolver,
                           @Autowired(required = false) ai.dat.project.datastore.service.GlobalConfigService globalConfigService) {
        this.runnerService = runnerService;
        this.serverConfig = serverConfig;
        this.indexContextResolver = indexContextResolver;
        this.globalConfigService = globalConfigService;
        log.info("McpToolsService initialized, indexContextResolver={}, globalConfigService={}",
                indexContextResolver != null ? "present" : "null",
                globalConfigService != null ? "present" : "null");
    }

    /*@Tool(name = "agents", description = "List agents information of ask data. " +
            "In MongoDB mode: if projectId is provided, lists agents of that project; " +
            "if omitted, lists agents across ALL projects (each entry tagged with projectId/projectName).")
    public String agents(
            @ToolParam(description = "Project ID. Optional in MongoDB mode (omit to list all projects).", required = false) String projectId)
            throws JsonProcessingException {
        try {
            // 单项目模式:传了 projectId,或者文件模式(只有一个项目)
            if (projectId != null && !projectId.isBlank()) {
                DatProject project = runnerService.getProject(projectId);
                List<Map<String, String>> agentList = project.getAgents().stream()
                        .map(agent -> Map.of(
                                "name", agent.getName(),
                                "description", agent.getDescription() == null ? "<none>" : agent.getDescription()))
                        .collect(Collectors.toList());
                return JSON_MAPPER.writeValueAsString(agentList);
            }
            // MongoDB 模式 + 没传 projectId → 列举所有项目的 agents
            List<ProjectService.ProjectListItem> projects = runnerService.listAllProjects();
            if (!projects.isEmpty()) {
                List<Map<String, String>> allAgents = projects.stream()
                        .flatMap(p -> p.project().getAgents().stream().map(agent -> Map.of(
                                "projectId", p.projectId(),
                                "projectName", p.projectName() == null ? "<unnamed>" : p.projectName(),
                                "name", agent.getName(),
                                "description", agent.getDescription() == null ? "<none>" : agent.getDescription())))
                        .collect(Collectors.toList());
                return JSON_MAPPER.writeValueAsString(allAgents);
            }
            // 文件模式 fallback
            DatProject project = runnerService.getProject();
            List<Map<String, String>> agentList = project.getAgents().stream()
                    .map(agent -> Map.of(
                            "name", agent.getName(),
                            "description", agent.getDescription() == null ? "<none>" : agent.getDescription()))
                    .collect(Collectors.toList());
            return JSON_MAPPER.writeValueAsString(agentList);
        } catch (RuntimeException e) {
            log.warn("Failed to list agents: {}", e.getMessage());
            return "Failed to list agents: " + e.getMessage();
        }
    }*/

    @Tool(name = "ask_data", description = "Ask data using natural language.")
    public String ask(
            @ToolParam(description = "Conversation ID, to continue the conversation based on previous chat records.", required = false) String conversationId,
            @ToolParam(description = "Project ID. Required if running in MongoDB mode.", required = false) String projectId,
            @ToolParam(description = "Datasource ID. Optional, will auto-select first one if not provided.", required = false) String datasourceId,
            @ToolParam(description = "Ask data agent name. Defaults to \"default\"", required = false) String agentName,
            @ToolParam(description = "User's org code. Required when project has `index-ask: true`; ignored otherwise.", required = false) String orgCode,
            @ToolParam(description = "User question") String question) {

        conversationId = (conversationId == null || conversationId.isBlank() ? UUID.randomUUID().toString()
                : conversationId);

        agentName = (agentName == null || agentName.isBlank() ? "default" : agentName);

        // 应用默认项目和数据源配置
        projectId = applyDefaultProjectId(projectId);
        datasourceId = applyDefaultDatasourceId(datasourceId);

        // Get history
        List<QuestionSqlPair> histories = QuestionSqlPairCacheUtil.get(conversationId);

        // 解析 IndexContext
        Map<String, Object> attributes = buildRequestAttributes(projectId, datasourceId, question, orgCode);

        // Call runner service with attributes
        StreamAction action = runnerService.ask(conversationId, projectId, datasourceId, agentName, question,
                histories, attributes);

        StringBuilder result = new StringBuilder();

        String sql = NOT_GENERATE;
        String lastEvent = "";
        boolean lastIncremental = false;
        boolean isAccurateSql = false;
        for (StreamEvent event : action) {
            if (event == null)
                break;
            String eventName = event.name();
            if (event.getSemanticSql().isPresent()) {
                sql = event.getSemanticSql().get();
            }
            if (event.getQueryData().isPresent()) {
                isAccurateSql = true;
            }
            if (!lastEvent.equals(eventName)) {
                if (lastIncremental)
                    result.append("\n");
                lastEvent = eventName;
                lastIncremental = event.getIncrementalContent().isPresent();
                result.append("--------------------- ").append(eventName).append(" ---------------------\n");
            }
            append(event, result);
        }

        if (lastIncremental)
            result.append("\n");
        if (!isAccurateSql && !NOT_GENERATE.equals(sql)) {
            sql = "/* Incorrect SQL */ " + sql;
        }
        QuestionSqlPairCacheUtil.add(conversationId, QuestionSqlPair.from(question, sql));

        return result.toString();
    }

    /**
     * 构造透传给 Agent 的 attributes Map(IndexContext 等)。
     * Resolver 不存在或 projectId 缺失时返回空 Map。
     */
    private Map<String, Object> buildRequestAttributes(String projectId, String datasourceId,
                                                        String question, String orgCode) {
        if (indexContextResolver == null || projectId == null || projectId.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            ContentStore contentStore = null;
            try {
                contentStore = runnerService.getProjectRunner(projectId, datasourceId).getContentStore();
            } catch (Exception ex) {
                log.warn("MCP failed to get ContentStore for index context: {}", ex.getMessage());
            }
            IndexContext ctx = indexContextResolver.resolve(contentStore, projectId, question, orgCode);
            return Map.of(DefaultAskdataAgent.ATTR_INDEX_CONTEXT, ctx);
        } catch (Exception e) {
            log.warn("MCP IndexContextResolver failed: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    private void append(StreamEvent event, StringBuilder result) {
        event.getHitlAiRequest().ifPresent(request -> {
            // throw new RuntimeException("HITL (Human-in-the-loop) is not supported.");
            result.append("HITL Request: ").append(request).append("\n");
        });
        event.getHitlToolApproval().ifPresent(prompt -> {
            // throw new RuntimeException("HITL (Human-in-the-loop) is not supported.");
            result.append("HITL Approval: ").append(prompt).append("\n");
        });
        event.getIncrementalContent().ifPresent(result::append);
        event.getSemanticSql().ifPresent(content -> result.append("SQL: ").append(content).append("\n"));
        event.getQueryData().ifPresent(data -> {
            try {
                String queryResults = JSON_MAPPER.writeValueAsString(data);
                result.append("Query Results: ").append(queryResults).append("\n");
            } catch (JsonProcessingException e) {
                result.append("Failed to serialize query results to JSON: ")
                        .append(e.getMessage()).append("\n");
            }
        });
        event.getToolExecutionRequest().ifPresent(request -> result.append("id: ").append(request.id())
                .append("\nname: ").append(request.name())
                .append("\narguments: ").append(request.arguments()).append("\n"));
        event.getToolExecutionResult()
                .ifPresent(toolResult -> result.append("result: ").append(toolResult).append("\n"));
        Map<String, Object> messages = event.getMessages();
        if (messages != null && !messages.isEmpty()) {
            try {
                result.append(JSON_MAPPER.writeValueAsString(messages)).append("\n");
            } catch (JsonProcessingException e) {
                result.append("Failed to serialize messages to JSON: ")
                        .append(e.getMessage()).append("\n");
            }
        }
    }

    /**
     * 应用默认项目 ID 配置。
     */
    private String applyDefaultProjectId(String projectId) {
        if ((projectId == null || projectId.isBlank()) && globalConfigService != null) {
            try {
                ai.dat.project.datastore.document.GlobalConfigDocument config = globalConfigService.getGlobalConfig();
                if (config.getDefaultProjectId() != null && !config.getDefaultProjectId().isBlank()) {
                    log.debug("MCP applied default project_id from database: {}", config.getDefaultProjectId());
                    return config.getDefaultProjectId();
                }
            } catch (Exception e) {
                log.warn("Failed to get default project_id from database: {}", e.getMessage());
            }
        }
        return projectId;
    }

    /**
     * 应用默认数据源 ID 配置。
     */
    private String applyDefaultDatasourceId(String datasourceId) {
        if ((datasourceId == null || datasourceId.isBlank()) && globalConfigService != null) {
            try {
                ai.dat.project.datastore.document.GlobalConfigDocument config = globalConfigService.getGlobalConfig();
                if (config.getDefaultDatasourceId() != null && !config.getDefaultDatasourceId().isBlank()) {
                    log.debug("MCP applied default datasource_id from database: {}", config.getDefaultDatasourceId());
                    return config.getDefaultDatasourceId();
                }
            } catch (Exception e) {
                log.warn("Failed to get default datasource_id from database: {}", e.getMessage());
            }
        }
        return datasourceId;
    }
}
