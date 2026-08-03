package ai.dat.server.openapi.config;

import ai.dat.boot.utils.ProjectUtil;
import ai.dat.core.data.project.DatProject;
import ai.dat.core.data.project.LlmConfig;
import ai.dat.core.factories.data.FactoryDescriptor;
import ai.dat.core.utils.FactoryUtil;
import ai.dat.project.datastore.document.ProjectDocument;
import ai.dat.project.datastore.service.ProjectService;
import dev.langchain4j.model.chat.ChatModel;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 为 SemanticModelGeneratorService 提供默认的 ChatModel Bean
 *
 * 支持两种模式:
 * 1. MongoDB 模式: 从数据库中第一个项目加载 LLM 配置
 * 2. 文件模式: 从本地项目文件加载 LLM 配置
 */
@Configuration
@Slf4j
public class LlmBeanConfig {

    private final ServerConfig serverConfig;
    private final ProjectService projectService;

    @Autowired
    public LlmBeanConfig(
            ServerConfig serverConfig,
            @Autowired(required = false) @Qualifier("datastoreProjectService") ProjectService projectService) {
        this.serverConfig = serverConfig;
        this.projectService = projectService;
    }

    @Bean
    public ChatModel defaultChatModel() {
        LlmConfig defaultLlm = null;

        if (serverConfig.isMongoMode() && projectService != null) {
            // MongoDB 模式: 从数据库加载
            defaultLlm = loadLlmFromMongoDB();
        } else if (serverConfig.isFileMode()) {
            // 文件模式: 从本地项目加载
            defaultLlm = loadLlmFromFile();
        }

        if (defaultLlm == null) {
            log.warn("No ChatModel configuration found, ChatModel bean will not be created");
            return null;
        }

        log.info("Initializing default ChatModel, name={}, provider={}",
                defaultLlm.getName(), defaultLlm.getProvider());

        FactoryDescriptor descriptor = FactoryDescriptor.from(
                defaultLlm.getProvider(),
                defaultLlm.getConfiguration()
        );
        return FactoryUtil.createChatModel(descriptor);
    }

    /**
     * 从 MongoDB 加载第一个可用项目的 LLM 配置
     */
    private LlmConfig loadLlmFromMongoDB() {
        try {
            List<ProjectDocument> projects = projectService.listAll();
            if (projects == null || projects.isEmpty()) {
                log.warn("No projects found in MongoDB");
                return null;
            }

            // 使用第一个项目的 LLM 配置
            ProjectDocument project = projects.get(0);
            List<ProjectDocument.LlmConfigDoc> llms = project.getLlms();

            if (llms == null || llms.isEmpty()) {
                log.warn("No LLM configured in project: {}", project.getName());
                return null;
            }

            // 选择默认 LLM
            ProjectDocument.LlmConfigDoc llmDoc = llms.stream()
                    .filter(llm -> LlmConfig.DEFAULT_NAME.equals(llm.getName()))
                    .findFirst()
                    .orElseGet(() -> llms.get(0));

            log.info("Loading LLM from MongoDB project: {}, llm: {}", project.getName(), llmDoc.getName());

            return convertToLlmConfig(llmDoc);
        } catch (Exception e) {
            log.error("Failed to load LLM from MongoDB", e);
            return null;
        }
    }

    /**
     * 从本地项目文件加载 LLM 配置
     */
    private LlmConfig loadLlmFromFile() {
        try {
            Path projectPath = serverConfig.getAbsoluteProjectPath();
            DatProject project = ProjectUtil.loadProject(projectPath);
            List<LlmConfig> llms = project.getLlms();

            if (llms == null || llms.isEmpty()) {
                log.warn("No LLM configured in local project");
                return null;
            }

            log.info("Loading LLM from local project: {}", projectPath);

            return llms.stream()
                    .filter(llm -> LlmConfig.DEFAULT_NAME.equals(llm.getName()))
                    .findFirst()
                    .orElseGet(() -> llms.get(0));
        } catch (Exception e) {
            log.error("Failed to load LLM from local project", e);
            return null;
        }
    }

    /**
     * 将 MongoDB LLM 文档转换为 LlmConfig
     */
    private LlmConfig convertToLlmConfig(ProjectDocument.LlmConfigDoc doc) {
        LlmConfig config = new LlmConfig();
        config.setName(doc.getName());
        config.setProvider(doc.getProvider());
        config.setConfiguration(doc.getConfiguration());
        return config;
    }
}
