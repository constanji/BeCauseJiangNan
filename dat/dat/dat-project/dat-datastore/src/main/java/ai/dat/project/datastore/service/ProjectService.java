package ai.dat.project.datastore.service;

import ai.dat.core.data.project.*;
import ai.dat.project.datastore.document.ProjectDocument;
import ai.dat.project.datastore.document.ProjectDocument.*;
import ai.dat.project.datastore.event.ProjectChangedEvent;
import ai.dat.project.datastore.repository.ProjectRepository;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * 项目服务类
 * 提供项目的 CRUD 操作和与 DatProject 对象的转换
 *
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Slf4j
@Service("datastoreProjectService")
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final ApplicationEventPublisher eventPublisher;

    public ProjectService(ProjectRepository projectRepository, ApplicationEventPublisher eventPublisher) {
        this.projectRepository = projectRepository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * 创建项目
     *
     * @param name 项目名称
     * @param description 项目描述
     * @return 创建的项目文档
     */
    public ProjectDocument create(@NonNull String name, String description) {
        if (projectRepository.existsByName(name)) {
            throw new IllegalArgumentException("Project with name '" + name + "' already exists");
        }

        ProjectDocument document = ProjectDocument.builder()
                .version(1)
                .name(name)
                .description(description)
                .configuration(new HashMap<>())
                .createdAt(LocalDateTime.now())
                .updatedAt(LocalDateTime.now())
                .build();

        ProjectDocument saved = projectRepository.save(document);
        eventPublisher.publishEvent(new ProjectChangedEvent(this, saved.getId(), ProjectChangedEvent.ChangeType.CREATED));
        log.info("Project created: {} ({})", name, saved.getId());
        return saved;
    }

    /**
     * 创建项目（直接使用文档对象）
     *
     * @param document 项目文档
     * @return 创建的项目文档
     */
    public ProjectDocument create(@NonNull ProjectDocument document) {
        if (document.getName() != null && projectRepository.existsByName(document.getName())) {
            throw new IllegalArgumentException("Project with name '" + document.getName() + "' already exists");
        }
        document.setCreatedAt(LocalDateTime.now());
        document.setUpdatedAt(LocalDateTime.now());
        ProjectDocument saved = projectRepository.save(document);
        eventPublisher.publishEvent(new ProjectChangedEvent(this, saved.getId(), ProjectChangedEvent.ChangeType.CREATED));
        log.info("Project created: {} ({})", saved.getName(), saved.getId());
        return saved;
    }

    /**
     * 根据 DatProject 创建项目
     *
     * @param datProject DatProject 对象
     * @return 创建的项目文档
     */
    public ProjectDocument createFromDatProject(@NonNull DatProject datProject) {
        if (projectRepository.existsByName(datProject.getName())) {
            throw new IllegalArgumentException("Project with name '" + datProject.getName() + "' already exists");
        }

        ProjectDocument document = fromDatProject(datProject);
        document.setCreatedAt(LocalDateTime.now());
        document.setUpdatedAt(LocalDateTime.now());

        ProjectDocument saved = projectRepository.save(document);
        eventPublisher.publishEvent(new ProjectChangedEvent(this, saved.getId(), ProjectChangedEvent.ChangeType.CREATED));
        log.info("Project created from DatProject: {} ({})", saved.getName(), saved.getId());
        return saved;
    }

    /**
     * 根据ID查询项目
     *
     * @param projectId 项目ID
     * @return 项目文档
     */
    public ProjectDocument getById(@NonNull String projectId) {
        return projectRepository.findById(projectId)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + projectId));
    }

    /**
     * 根据名称查询项目
     *
     * @param name 项目名称
     * @return 项目文档
     */
    public Optional<ProjectDocument> getByName(@NonNull String name) {
        return projectRepository.findByName(name);
    }

    /**
     * 查询所有项目
     *
     * @return 项目列表
     */
    public List<ProjectDocument> listAll() {
        return projectRepository.findAll();
    }

    /**
     * 更新项目
     *
     * @param projectId 项目ID
     * @param document 更新的项目文档
     * @return 更新后的项目文档
     */
    public ProjectDocument update(@NonNull String projectId, @NonNull ProjectDocument document) {
        ProjectDocument existing = getById(projectId);

        // 保留ID和创建时间
        document.setId(existing.getId());
        document.setCreatedAt(existing.getCreatedAt());
        document.setUpdatedAt(LocalDateTime.now());

        ProjectDocument saved = projectRepository.save(document);
        eventPublisher.publishEvent(new ProjectChangedEvent(this, projectId, ProjectChangedEvent.ChangeType.UPDATED));
        log.info("Project updated: {} ({})", saved.getName(), projectId);
        return saved;
    }

    /**
     * 删除项目
     *
     * @param projectId 项目ID
     */
    public void delete(@NonNull String projectId) {
        if (!projectRepository.existsById(projectId)) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }
        projectRepository.deleteById(projectId);
        eventPublisher.publishEvent(new ProjectChangedEvent(this, projectId, ProjectChangedEvent.ChangeType.DELETED));
        log.info("Project deleted: {}", projectId);
    }

    /**
     * 将 MongoDB 文档转换为 DatProject 对象
     *
     * @param document 项目文档
     * @return DatProject 对象
     */
    public DatProject toDatProject(@NonNull ProjectDocument document) {
        DatProject datProject = new DatProject();

        datProject.setVersion(document.getVersion());
        datProject.setName(document.getName());
        datProject.setDescription(document.getDescription());

        // 设置配置
        if (document.getConfiguration() != null) {
            datProject.setConfiguration(document.getConfiguration());
        }

        // 设置数据库配置
        if (document.getDb() != null) {
            DatabaseConfig dbConfig = new DatabaseConfig();
            dbConfig.setProvider(document.getDb().getProvider());
            if (document.getDb().getConfiguration() != null) {
                dbConfig.setConfiguration(document.getDb().getConfiguration());
            }
            datProject.setDb(dbConfig);
        }

        // 设置嵌入模型配置
        if (document.getEmbedding() != null) {
            EmbeddingConfig embeddingConfig = new EmbeddingConfig();
            embeddingConfig.setProvider(document.getEmbedding().getProvider());
            if (document.getEmbedding().getConfiguration() != null) {
                embeddingConfig.setConfiguration(document.getEmbedding().getConfiguration());
            }
            datProject.setEmbedding(embeddingConfig);
        }

        // 设置嵌入存储配置
        if (document.getEmbeddingStore() != null) {
            EmbeddingStoreConfig storeConfig = new EmbeddingStoreConfig();
            storeConfig.setProvider(document.getEmbeddingStore().getProvider());
            if (document.getEmbeddingStore().getConfiguration() != null) {
                storeConfig.setConfiguration(document.getEmbeddingStore().getConfiguration());
            }
            datProject.setEmbeddingStore(storeConfig);
        }

        // 设置LLM配置
        if (document.getLlms() != null) {
            List<LlmConfig> llmConfigs = document.getLlms().stream()
                    .map(llmDoc -> {
                        LlmConfig llmConfig = new LlmConfig();
                        llmConfig.setName(llmDoc.getName());
                        llmConfig.setProvider(llmDoc.getProvider());
                        if (llmDoc.getConfiguration() != null) {
                            llmConfig.setConfiguration(llmDoc.getConfiguration());
                        }
                        return llmConfig;
                    })
                    .collect(Collectors.toList());
            datProject.setLlms(llmConfigs);
        }

        // 设置重排序配置
        if (document.getReranking() != null) {
            RerankingConfig rerankingConfig = new RerankingConfig();
            rerankingConfig.setProvider(document.getReranking().getProvider());
            if (document.getReranking().getConfiguration() != null) {
                rerankingConfig.setConfiguration(document.getReranking().getConfiguration());
            }
            datProject.setReranking(rerankingConfig);
        }

        // 设置内容存储配置
        if (document.getContentStore() != null) {
            ContentStoreConfig contentStoreConfig = new ContentStoreConfig();
            contentStoreConfig.setProvider(document.getContentStore().getProvider());
            if (document.getContentStore().getConfiguration() != null) {
                contentStoreConfig.setConfiguration(document.getContentStore().getConfiguration());
            }
            datProject.setContentStore(contentStoreConfig);
        }

        // 设置代理配置
        if (document.getAgents() != null) {
            List<AgentConfig> agentConfigs = document.getAgents().stream()
                    .map(agentDoc -> {
                        AgentConfig agentConfig = new AgentConfig();
                        agentConfig.setName(agentDoc.getName());
                        agentConfig.setDescription(agentDoc.getDescription());
                        agentConfig.setProvider(agentDoc.getProvider());
                        if (agentDoc.getConfiguration() != null) {
                            agentConfig.setConfiguration(agentDoc.getConfiguration());
                        }
                        return agentConfig;
                    })
                    .collect(Collectors.toList());
            datProject.setAgents(agentConfigs);
        }

        return datProject;
    }

    /**
     * 将 DatProject 对象转换为 MongoDB 文档
     *
     * @param datProject DatProject 对象
     * @return 项目文档
     */
    public ProjectDocument fromDatProject(@NonNull DatProject datProject) {
        ProjectDocumentBuilder builder = ProjectDocument.builder()
                .version(datProject.getVersion())
                .name(datProject.getName())
                .description(datProject.getDescription());

        // 转换数据库配置
        if (datProject.getDb() != null) {
            builder.db(DatabaseConfigDoc.builder()
                    .provider(datProject.getDb().getProvider())
                    .configuration(configToMap(datProject.getDb().getConfiguration()))
                    .build());
        }

        // 转换嵌入模型配置
        if (datProject.getEmbedding() != null) {
            builder.embedding(EmbeddingConfigDoc.builder()
                    .provider(datProject.getEmbedding().getProvider())
                    .configuration(configToMap(datProject.getEmbedding().getConfiguration()))
                    .build());
        }

        // 转换嵌入存储配置
        if (datProject.getEmbeddingStore() != null) {
            builder.embeddingStore(EmbeddingStoreConfigDoc.builder()
                    .provider(datProject.getEmbeddingStore().getProvider())
                    .configuration(configToMap(datProject.getEmbeddingStore().getConfiguration()))
                    .build());
        }

        // 转换LLM配置
        if (datProject.getLlms() != null) {
            List<LlmConfigDoc> llmDocs = datProject.getLlms().stream()
                    .map(llm -> LlmConfigDoc.builder()
                            .name(llm.getName())
                            .provider(llm.getProvider())
                            .configuration(configToMap(llm.getConfiguration()))
                            .build())
                    .collect(Collectors.toList());
            builder.llms(llmDocs);
        }

        // 转换重排序配置
        if (datProject.getReranking() != null) {
            builder.reranking(RerankingConfigDoc.builder()
                    .provider(datProject.getReranking().getProvider())
                    .configuration(configToMap(datProject.getReranking().getConfiguration()))
                    .build());
        }

        // 转换内容存储配置
        if (datProject.getContentStore() != null) {
            builder.contentStore(ContentStoreConfigDoc.builder()
                    .provider(datProject.getContentStore().getProvider())
                    .configuration(configToMap(datProject.getContentStore().getConfiguration()))
                    .build());
        }

        // 转换代理配置
        if (datProject.getAgents() != null) {
            List<AgentConfigDoc> agentDocs = datProject.getAgents().stream()
                    .map(agent -> AgentConfigDoc.builder()
                            .name(agent.getName())
                            .description(agent.getDescription())
                            .provider(agent.getProvider())
                            .configuration(configToMap(agent.getConfiguration()))
                            .build())
                    .collect(Collectors.toList());
            builder.agents(agentDocs);
        }

        return builder.build();
    }

    /**
     * 将 ReadableConfig 转换为 Map
     */
    private Map<String, Object> configToMap(ai.dat.core.configuration.ReadableConfig config) {
        if (config == null) {
            return new HashMap<>();
        }
        // 由于 ReadableConfig 没有提供直接转换为 Map 的方法，这里返回空 Map
        // 实际实现中可能需要根据具体的 ConfigOption 来构建 Map
        return new HashMap<>();
    }

}
