package ai.dat.server.mcp.config;

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
 * DAT MCP Server 配置
 * 
 * 支持两种模式：
 * 1. MongoDB 模式 - 配置 MongoDB 连接后，通过 API 请求动态传入 projectId
 * 2. 文件模式 - 使用固定的本地项目（向后兼容）
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

    public boolean isMongoMode() {
        return "mongodb".equalsIgnoreCase(mode);
    }

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