package ai.dat.server.openapi.config;

import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.MongoDatabaseFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.SimpleMongoClientDatabaseFactory;
import org.springframework.data.mongodb.repository.config.EnableMongoRepositories;

/**
 * MongoDB 配置
 * 只在 mode=mongodb 时启用
 *
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Configuration
@ConditionalOnProperty(prefix = "dat.server", name = "mode", havingValue = "mongodb")
@ComponentScan(basePackages = {
        "ai.dat.project.datastore.service",
        "ai.dat.project.datastore.provider",
        "ai.dat.project.datasource.service",
})
@EnableMongoRepositories(basePackages = {
        "ai.dat.project.datastore.repository",
        "ai.dat.project.datasource.repository",
})
public class MongoDbConfig {

    @Bean
    public MongoClient mongoClient(MongoProperties mongoProperties) {
        return MongoClients.create(mongoProperties.getUri());
    }

    @Bean
    public MongoDatabaseFactory mongoDatabaseFactory(MongoClient mongoClient, MongoProperties mongoProperties) {
        return new SimpleMongoClientDatabaseFactory(mongoClient, mongoProperties.getDatabase());
    }

    @Bean
    public MongoTemplate mongoTemplate(MongoDatabaseFactory mongoDatabaseFactory) {
        return new MongoTemplate(mongoDatabaseFactory);
    }
}
