package ai.dat.server.openapi.service;

import ai.dat.boot.ProjectRunner;
import ai.dat.boot.utils.ProjectUtil;
import ai.dat.core.agent.data.StreamAction;
import ai.dat.core.contentstore.data.QuestionSqlPair;
import ai.dat.core.data.project.DatProject;
import ai.dat.core.data.project.DatabaseConfig;
import ai.dat.project.datasource.document.DatasourceDocument;
import ai.dat.project.datasource.service.DatasourceService;
import ai.dat.project.datastore.document.ProjectDocument;
import ai.dat.project.datastore.event.ProjectChangedEvent;
import ai.dat.server.openapi.config.ServerConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.base.Preconditions;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 项目服务
 * 支持项目ID和数据源ID传入，根据问题智能选择语义模型
 * 支持从MongoDB加载项目配置
 *
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Slf4j
@Service
public class ProjectService {

    private final ServerConfig serverConfig;
    private final DatasourceService datasourceService;
    private final ai.dat.project.datastore.service.ProjectService mongoProjectService;
    private final ai.dat.project.datastore.service.LightSchemaPersistenceService lightSchemaPersistenceService;
    private final ai.dat.project.datastore.service.IndexEntryPersistenceService indexEntryPersistenceService;
    private final ai.dat.core.index.bm25.IndexBm25Index bm25Index;
    private final ObjectMapper objectMapper;

    private static final Map<String, ProjectRunner> projectRunnerPool = new ConcurrentHashMap<>();

    @Autowired
    public ProjectService(ServerConfig serverConfig,
                          @Autowired(required = false) @Qualifier("datastoreDatasourceService") DatasourceService datasourceService,
                          @Autowired(required = false) ai.dat.project.datastore.service.ProjectService mongoProjectService,
                          @Autowired(required = false) ai.dat.project.datastore.service.LightSchemaPersistenceService lightSchemaPersistenceService,
                          @Autowired(required = false) ai.dat.project.datastore.service.IndexEntryPersistenceService indexEntryPersistenceService,
                          @Autowired(required = false) ai.dat.core.index.bm25.IndexBm25Index bm25Index,
                          ObjectMapper objectMapper) {
        this.serverConfig = serverConfig;
        this.datasourceService = datasourceService;
        this.mongoProjectService = mongoProjectService;
        this.lightSchemaPersistenceService = lightSchemaPersistenceService;
        this.indexEntryPersistenceService = indexEntryPersistenceService;
        this.bm25Index = bm25Index;
        this.objectMapper = objectMapper;
        log.info(
                "ProjectService initialized, mongoMode={}, datasourceService={}, mongoProjectService={}, lightSchemaPersistenceService={}, indexEntryPersistenceService={}",
                serverConfig.isMongoMode(),
                datasourceService != null ? "present" : "null",
                mongoProjectService != null ? "present" : "null",
                lightSchemaPersistenceService != null ? "present" : "null",
                indexEntryPersistenceService != null ? "present" : "null");
    }

    private ProjectRunner getProjectRunner(@NonNull String conversationId,
            String projectId,
            String datasourceId,
            String agentName,
            String question,
            String userId,
            String agentId) {
        String runnerKey = conversationId + "::" + (datasourceId == null ? "_default" : datasourceId);
        ProjectRunner projectRunner = projectRunnerPool.get(runnerKey);
        if (projectRunner == null) {
            Preconditions.checkArgument(agentName != null && !agentName.isEmpty(),
                    "The agent name cannot be empty");

            try {
                DatProject project;
                Path projectPath = serverConfig.getAbsoluteProjectPath();
                Map<String, Object> variables = serverConfig.getVariables();

                // 根据是否有 projectId 决定加载方式
                if (serverConfig.isMongoMode() && projectId != null && !projectId.isBlank()
                        && mongoProjectService != null) {
                    // MongoDB 模式：从数据库加载项目
                    ProjectDocument projectDoc = mongoProjectService.getById(projectId);
                    project = mongoProjectService.toDatProject(projectDoc);
                    log.info("Loaded project from MongoDB: {} ({})", project.getName(), projectId);
                } else {
                    // 文件模式：从本地文件加载
                    project = ProjectUtil.loadProject(projectPath);
                    log.info("Loaded project from file: {}", projectPath);
                }

                // 如果项目没有配置 agents，创建默认的 askdata agent
                if (project.getAgents() == null || project.getAgents().isEmpty()) {
                    ai.dat.core.data.project.AgentConfig defaultAgent = new ai.dat.core.data.project.AgentConfig();
                    defaultAgent.setName("default");
                    defaultAgent.setProvider("askdata");
                    project.setAgents(List.of(defaultAgent));
                    log.info("Created default askdata agent for project: {}", project.getName());
                }

                // 确保 db 配置存在
                if (project.getDb() == null) {
                    project.setDb(new DatabaseConfig());
                    log.warn("Project has no db config, created empty one");
                }

                log.info("Checking datasource injection: datasourceId={}, datasourceService={}", datasourceId,
                        datasourceService);
                if (datasourceId != null && !datasourceId.isBlank() && datasourceService != null) {
                    // 获取数据源配置并覆盖项目数据库配置
                    DatasourceDocument ds = datasourceService.getById(datasourceId);
                    if (ds != null) {
                        DatabaseConfig dbConfig = project.getDb();
                        dbConfig.setProvider(ds.getProvider());
                        Map<String, Object> dsConfig = ds.getConfiguration();
                        log.info("Datasource configuration: {}", dsConfig);

                        // 转换配置格式：将 host/port/database 转换为 JDBC URL
                        Map<String, Object> convertedConfig = convertToJdbcConfig(ds.getProvider(), dsConfig);
                        log.info("Converted configuration: {}", convertedConfig);

                        dbConfig.setConfiguration(convertedConfig);
                        log.info("Using datasource: {} ({}) with config keys: {}", ds.getName(), ds.getProvider(),
                                convertedConfig.keySet());
                    } else {
                        log.warn("Datasource not found: {}", datasourceId);
                    }
                }

                // 使用新的5参数构造函数，MongoDB模式跳过build步骤
                boolean skipBuild = serverConfig.isMongoMode() && projectId != null && !projectId.isBlank();
                projectRunner = new ProjectRunner(projectPath, agentName, variables, project, skipBuild);
                // 将当前 ProjectRunner 的 ContentStore 绑定到指定 datasourceId，
                // 后续所有 LightSchema / Cell 的写入、检索、删除自动按 datasource_id 过滤，
                // 避免同一项目下多个数据源之间互相污染。
                if (datasourceId != null && !datasourceId.isBlank()) {
                    ai.dat.core.contentstore.ContentStore contentStore = projectRunner.getContentStore();
                    if (contentStore instanceof ai.dat.core.contentstore.DefaultContentStore) {
                        ((ai.dat.core.contentstore.DefaultContentStore) contentStore)
                                .setCurrentDatasourceId(datasourceId);
                        log.info("Bound ContentStore to datasourceId={} for runnerKey={}", datasourceId, runnerKey);
                    }
                }
                if (skipBuild) {
                    log.info("MongoDB mode: skipped ProjectBuilder.build() for project: {}", project.getName());
                    // 加载已有的 Light Schema 到 ContentStore (RAG)
                    if (lightSchemaPersistenceService != null && datasourceId != null) {
                        try {
                            List<ai.dat.core.contentstore.data.LightSchema> schemas = lightSchemaPersistenceService
                                    .getLightSchemas(projectId, datasourceId);
                            if (!schemas.isEmpty()) {
                                projectRunner.getContentStore().addLightSchemas(datasourceId, schemas);
                                log.info("Loaded {} existing light schemas from MongoDB to ContentStore (datasource={})",
                                        schemas.size(), datasourceId);
                            }
                        } catch (Exception e) {
                            log.warn("Failed to load existing light schemas from MongoDB: {}", e.getMessage());
                        }
                    }
                    // 加载已有的 IndexEntry 到 ContentStore 向量库(供问数请求中的语义召回)
                    // 重启后向量库会重置,这里 warm-up;失败仅 warn,Mongo 仍是权威源
                    if (indexEntryPersistenceService != null && projectId != null) {
                        try {
                            List<ai.dat.core.contentstore.data.IndexEntry> entries =
                                    indexEntryPersistenceService.listAll(projectId);
                            if (!entries.isEmpty()) {
                                ai.dat.core.contentstore.ContentStore cs = projectRunner.getContentStore();
                                cs.removeAllIndexEntries(projectId);
                                cs.addIndexEntries(projectId, entries);
                                // 同步构建 BM25 倒排索引
                                if (bm25Index != null) {
                                    bm25Index.buildAll(entries);
                                    log.info("Warmed up {} index entries to BM25 (project={})",
                                            entries.size(), projectId);
                                }
                                log.info("Warmed up {} index entries from MongoDB to ContentStore (project={})",
                                        entries.size(), projectId);
                            }
                        } catch (UnsupportedOperationException uoe) {
                            log.debug("IndexEntry store not configured for project {}, skip warm-up", projectId);
                        } catch (Exception e) {
                            log.warn("Failed to warm up index entries from MongoDB: {}", e.getMessage());
                        }
                    }
                }
                projectRunnerPool.put(runnerKey, projectRunner);
            } catch (Exception e) {
                log.error("Failed to initialize project runner", e);
                throw new RuntimeException("Failed to initialize project runner: " + e.getMessage(), e);
            }
        }
        return projectRunner;
    }

    public DatProject getProject() {
        Path projectPath = serverConfig.getAbsoluteProjectPath();
        return ProjectUtil.loadProject(projectPath);
    }

    /**
     * 根据项目ID获取 ProjectRunner
     * 用于 ContentStore 访问等场景
     * 
     * @param projectId 项目ID
     * @return ProjectRunner 实例，如果不存在则创建新实例
     */
    public ProjectRunner getProjectRunner(@NonNull String projectId) {
        return getProjectRunner(projectId, null);
    }

    /**
     * 根据项目ID和数据源ID获取 ProjectRunner
     * 用于需要指定数据源的场景（如预处理）
     * 
     * @param projectId    项目ID
     * @param datasourceId 数据源ID（可选，为空时自动选择第一个）
     * @return ProjectRunner 实例
     */
    public ProjectRunner getProjectRunner(@NonNull String projectId, String datasourceId) {
        // 如果指定了 datasourceId，尝试查找已存在的精确匹配 runner
        if (datasourceId != null && !datasourceId.isBlank()) {
            for (Map.Entry<String, ProjectRunner> entry : projectRunnerPool.entrySet()) {
                String key = entry.getKey();
                if (key.contains(datasourceId)) {
                    log.info("Found existing ProjectRunner for datasourceId: {}", datasourceId);
                    return entry.getValue();
                }
            }
        } else {
            // 没有指定 datasourceId，尝试查找任何与项目关联的 runner
            for (Map.Entry<String, ProjectRunner> entry : projectRunnerPool.entrySet()) {
                String key = entry.getKey();
                if (key.contains(projectId)) {
                    log.info("Found existing ProjectRunner for projectId: {}", projectId);
                    return entry.getValue();
                }
            }
        }

        // 如果没有找到且未指定 datasourceId，获取该项目的第一个数据源
        if ((datasourceId == null || datasourceId.isBlank()) && serverConfig.isMongoMode()
                && datasourceService != null) {
            try {
                List<DatasourceDocument> datasources = datasourceService.listByProjectId(projectId);
                if (!datasources.isEmpty()) {
                    datasourceId = datasources.get(0).getId();
                    log.info("Auto-selected first datasource {} for project {}", datasourceId, projectId);
                } else {
                    log.warn("No datasources found for project {}, ContentStore operations may fail", projectId);
                }
            } catch (Exception e) {
                log.warn("Failed to fetch datasources for project {}: {}", projectId, e.getMessage());
            }
        }

        // 创建新的 runner
        String defaultConversationId = "content-store-" + projectId + "-"
                + (datasourceId != null ? datasourceId : "default");
        String defaultAgentName = "default";
        return getProjectRunner(defaultConversationId, projectId, datasourceId, defaultAgentName, null, null, null);
    }

    /**
     * 问数接口 - 支持项目ID、数据源ID和智能语义模型选择
     *
     * @param conversationId 会话ID
     * @param projectId      项目ID(前端选择的项目,MongoDB模式必须)
     * @param datasourceId   数据源ID(前端选择的数据源)
     * @param agentName      Agent名称
     * @param question       用户问题
     * @param histories      历史记录
     * @param userId         用户ID
     * @param agentId        Agent ID
     */
    public StreamAction ask(@NonNull String conversationId,
            String projectId,
            String datasourceId,
            @NonNull String agentName,
            @NonNull String question,
            @NonNull List<QuestionSqlPair> histories,
            String userId,
            String agentId) {
        return ask(conversationId, projectId, datasourceId, agentName, question, histories,
                userId, agentId, Collections.emptyMap());
    }

    /**
     * 问数接口(带请求级 attributes)。
     * <p>attributes 用于把 {@code IndexContext} / orgCode / staffNo 等"每次问数都可能不同"
     * 的请求参数透传到 Agent 内部 —— 它不同于 {@code variables}:variables 在 Runner 构造期
     * 一次性注入,Runner 缓存复用后无法变更;attributes 每次请求各自独立。
     */
    public StreamAction ask(@NonNull String conversationId,
            String projectId,
            String datasourceId,
            @NonNull String agentName,
            @NonNull String question,
            @NonNull List<QuestionSqlPair> histories,
            String userId,
            String agentId,
            Map<String, Object> attributes) {
        log.info("Ask request - conversation: {}, project: {}, datasource: {}, question: {}",
                conversationId, projectId, datasourceId, question);
        return getProjectRunner(conversationId, projectId, datasourceId, agentName, question, userId, agentId)
                .ask(question, histories, attributes);
    }

    public void userResponse(@NonNull String conversationId, @NonNull String response) {
        // 尝试查找对应的 runner
        for (String key : projectRunnerPool.keySet()) {
            if (key.startsWith(conversationId + "::")) {
                projectRunnerPool.get(key).userResponse(response);
                return;
            }
        }
    }

    public void userApproval(@NonNull String conversationId, @NonNull Boolean approval) {
        for (String key : projectRunnerPool.keySet()) {
            if (key.startsWith(conversationId + "::")) {
                projectRunnerPool.get(key).userApproval(approval);
                return;
            }
        }
    }

    public void clearConversation(@NonNull String conversationId) {
        projectRunnerPool.keySet().removeIf(key -> key.startsWith(conversationId + "::"));
    }

    /**
     * 清除指定项目的缓存，强制下次请求时重新加载配置
     * 当项目配置修改后调用此方法
     */
    public void refreshProject(@NonNull String projectId) {
        int before = projectRunnerPool.size();
        projectRunnerPool.keySet().removeIf(key -> key.contains(projectId));
        int removed = before - projectRunnerPool.size();
        log.info("Refreshed project cache for projectId: {}, removed {} entries", projectId, removed);
    }

    /**
     * 清除所有项目缓存，强制下次请求时重新加载配置
     */
    public void refreshAllProjects() {
        int size = projectRunnerPool.size();
        projectRunnerPool.clear();
        log.info("Refreshed all project caches, removed {} entries", size);
    }

    /**
     * 监听项目配置变更事件，自动刷新缓存
     * 当项目被创建、更新或删除时，自动清除对应的缓存
     */
    @EventListener
    public void onProjectChanged(ProjectChangedEvent event) {
        String projectId = event.getProjectId();
        ProjectChangedEvent.ChangeType changeType = event.getChangeType();

        log.info("Received project changed event: projectId={}, changeType={}", projectId, changeType);

        switch (changeType) {
            case CREATED:
                // 新创建的项目不需要清除缓存，因为还没有缓存
                log.info("New project created, no cache to clear: {}", projectId);
                break;
            case UPDATED:
                // 项目更新时清除缓存，强制下次请求时重新加载
                refreshProject(projectId);
                log.info("Project updated, cache cleared: {}", projectId);
                break;
            case DELETED:
                // 项目删除时清除缓存
                refreshProject(projectId);
                log.info("Project deleted, cache cleared: {}", projectId);
                break;
        }
    }

    /**
     * 将数据源配置转换为 JDBC 格式
     * 将 host/port/database 转换为 JDBC URL
     */
    private Map<String, Object> convertToJdbcConfig(String provider, Map<String, Object> config) {
        if (config == null) {
            return new java.util.HashMap<>();
        }

        Map<String, Object> result = new java.util.HashMap<>(config);

        // 如果已经有 url，直接返回
        if (config.containsKey("url")) {
            return result;
        }

        // 从 host/port/database 构建 JDBC URL
        String host = String.valueOf(config.getOrDefault("host", "localhost"));
        Object portObj = config.get("port");
        String database = String.valueOf(config.getOrDefault("database", ""));

        String jdbcUrl = null;
        switch (provider.toLowerCase()) {
            case "mysql":
                int mysqlPort = portObj != null ? Integer.parseInt(String.valueOf(portObj)) : 3306;
                jdbcUrl = String.format("jdbc:mysql://%s:%d/%s", host, mysqlPort, database);
                break;
            case "postgresql":
                int pgPort = portObj != null ? Integer.parseInt(String.valueOf(portObj)) : 5432;
                jdbcUrl = String.format("jdbc:postgresql://%s:%d/%s", host, pgPort, database);
                break;
            case "oracle":
                int oraclePort = portObj != null ? Integer.parseInt(String.valueOf(portObj)) : 1521;
                jdbcUrl = String.format("jdbc:oracle:thin:@%s:%d:%s", host, oraclePort, database);
                break;
            case "duckdb":
                jdbcUrl = String.format("jdbc:duckdb:%s", database);
                break;
            default:
                log.warn("Unknown database provider: {}, using config as-is", provider);
                return result;
        }

        result.put("url", jdbcUrl);
        // 移除不需要的字段
        result.remove("host");
        result.remove("port");
        result.remove("database");

        return result;
    }
}