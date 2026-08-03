package ai.dat.server.openapi.config;

import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * DAT OpenAPI Server 配置
 * 
 * 支持两种模式：
 * 1. MongoDB 模式（推荐）- 配置 MongoDB 连接后，通过 API 请求动态传入 projectId
 * 2. 文件模式（向后兼容）- 配置 project-path，使用固定的本地项目
 *
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Data
@Component
@ConfigurationProperties(prefix = "dat.server")
@Slf4j
public class ServerConfig {

    /**
     * 运行模式：mongodb 或 file
     * mongodb: 从 MongoDB 动态读取项目配置（projectId 在 API 请求中传入）
     * file: 从本地文件读取项目配置（向后兼容）
     */
    private String mode = "file";

    /**
     * 项目路径（仅文件模式使用）
     */
    private String projectPath;

    /**
     * 动态参数（仅文件模式使用）
     */
    private Map<String, Object> variables = Collections.emptyMap();

    /**
     * 判断是否为 MongoDB 模式
     */
    public boolean isMongoMode() {
        return "mongodb".equalsIgnoreCase(mode);
    }

    /**
     * 判断是否为文件模式
     */
    public boolean isFileMode() {
        return !isMongoMode();
    }

    public Path getAbsoluteProjectPath() {
        if (projectPath == null || projectPath.trim().isEmpty()) {
            return Paths.get(".").toAbsolutePath();
        }
        return Paths.get(projectPath).toAbsolutePath();
    }

    public Map<String, Object> getVariables() {
        return variables == null ? Collections.emptyMap() : new HashMap<>(variables);
    }
}