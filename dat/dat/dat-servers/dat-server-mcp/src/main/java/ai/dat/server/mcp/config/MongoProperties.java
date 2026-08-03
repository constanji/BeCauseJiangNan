package ai.dat.server.mcp.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * MongoDB 连接属性
 *
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Data
@Component
@ConfigurationProperties(prefix = "spring.data.mongodb")
public class MongoProperties {

    /**
     * MongoDB 连接 URI
     */
    private String uri = "mongodb://localhost:27017";

    /**
     * 数据库名称
     */
    private String database = "dat";
}
