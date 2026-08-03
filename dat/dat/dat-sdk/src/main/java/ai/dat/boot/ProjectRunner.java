package ai.dat.boot;

import ai.dat.boot.utils.ProjectUtil;
import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.agent.AskdataAgent;

import ai.dat.core.agent.data.StreamAction;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.QuestionSqlPair;
import ai.dat.core.data.project.AgentConfig;
import ai.dat.core.data.project.DatProject;
import com.google.common.base.Preconditions;
import lombok.Getter;
import lombok.NonNull;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * @Author JunjieM
 * @Date 2025/7/21
 */
@Getter
public class ProjectRunner {

    private final AskdataAgent agent;

    public ProjectRunner(@NonNull Path projectPath, @NonNull String agentName,
                         Map<String, Object> variables) {
        this(projectPath, agentName, variables, null, false);
    }

    public ProjectRunner(@NonNull Path projectPath, @NonNull String agentName,
                         Map<String, Object> variables,
                         DatProject projectOverride) {
        this(projectPath, agentName, variables, projectOverride, false);
    }


    /**
     * 构造函数 - 支持跳过 build 步骤（MongoDB 模式使用）
     *
     * @param projectPath 项目路径
     * @param agentName Agent 名称
     * @param variables 变量
     * @param projectOverride 覆盖的项目配置（可选）
     * @param skipBuild 是否跳过 build 步骤（MongoDB 模式设为 true）
     */
    public ProjectRunner(@NonNull Path projectPath, @NonNull String agentName,
                         Map<String, Object> variables,
                         DatProject projectOverride,
                         boolean skipBuild) {
        DatProject project = projectOverride != null ? projectOverride : ProjectUtil.loadProject(projectPath);
        Map<String, AgentConfig> agentMap = project.getAgents().stream()
                .collect(Collectors.toMap(AgentConfig::getName, o -> o));
        Preconditions.checkArgument(agentMap.containsKey(agentName),
                "The project doesn't exist agent: " + agentName);

        // 只有在非 skipBuild 模式下才执行 build
        if (!skipBuild) {
            ProjectBuilder builder = new ProjectBuilder(projectPath, project);
            try {
                builder.build(variables);
            } catch (IOException e) {
                throw new RuntimeException("The project build failed", e);
            }
        }

        this.agent = ProjectUtil.createAskdataAgent(project, agentName, projectPath, variables);

    }

    @Deprecated
    public ProjectRunner(@NonNull Path projectPath, @NonNull String agentName) {
        this(projectPath, agentName, null);
    }

    public StreamAction ask(@NonNull String question) {
        return agent.ask(question);
    }

    public StreamAction ask(@NonNull String question, @NonNull List<QuestionSqlPair> histories) {
        return agent.ask(question, histories);
    }

    /**
     * 带请求级 attributes 的 ask。
     * <p>用于把 {@code IndexContext} / orgCode / staffNo 等每次请求都可能不同的参数
     * 透传到 Agent 内部,绕开 Runner 缓存的 variables 通道(variables 只在构造期注入一次)。
     */
    public StreamAction ask(@NonNull String question,
                             @NonNull List<QuestionSqlPair> histories,
                             java.util.Map<String, Object> attributes) {
        return agent.ask(question, histories, attributes);
    }

    public void userResponse(@NonNull String response) {
        agent.userResponse(response);
    }

    public void userApproval(@NonNull Boolean approval) {
        agent.userApproval(approval);
    }

    /**
     * 获取 ContentStore 实例
     * 用于内容存储管理（SQL示例对、同义词、业务知识的 CRUD 操作）
     *
     * @return ContentStore 实例
     */
    public ContentStore getContentStore() {
        return agent.contentStore();
    }

    public DatabaseAdapter getDatabaseAdapter() {
        return agent.databaseAdapter();
    }
}
