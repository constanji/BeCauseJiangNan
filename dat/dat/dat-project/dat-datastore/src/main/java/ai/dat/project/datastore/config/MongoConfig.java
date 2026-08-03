package ai.dat.project.datastore.config;

import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * MongoDB 连接配置类
 * 
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Data
@Slf4j
@Configuration
@ConfigurationProperties(prefix = "dat.mongodb")
public class MongoConfig {

    /**
     * MongoDB 连接 URI
     * 示例: mongodb://localhost:27017
     */
    private String uri = "mongodb://localhost:27017";

    /**
     * 数据库名称
     */
    private String database = "dat";

    /**
     * 连接超时时间（毫秒）
     */
    private int connectTimeout = 10000;

    /**
     * 读取超时时间（毫秒）
     */
    private int readTimeout = 10000;

    /**
     * 最小连接池大小
     */
    private int minPoolSize = 5;

    /**
     * 最大连接池大小
     */
    private int maxPoolSize = 100;

    /**
     * 最大等待时间（毫秒）
     */
    private int maxWaitTime = 120000;

}
