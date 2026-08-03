package ai.dat.project.datastore.document;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * MongoDB 项目文档模型
 * 对应原有 dat_project.yaml 配置文件的内容
 * 
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "projects")
public class ProjectDocument {

    /**
     * 项目唯一标识
     */
    @Id
    private String id;

    /**
     * 配置版本号
     */
    private Integer version = 1;

    /**
     * 项目名称（唯一）
     */
    @Indexed(unique = true)
    private String name;

    /**
     * 项目描述
     */
    private String description;

    /**
     * 项目配置（对应 configuration 节点）
     */
    private Map<String, Object> configuration;

    /**
     * 数据库配置
     */
    private DatabaseConfigDoc db;

    /**
     * 嵌入模型配置
     */
    private EmbeddingConfigDoc embedding;

    /**
     * 嵌入存储配置 (支持 snake_case: embedding_store)
     */
    @JsonProperty("embedding_store")
    @Field("embedding_store")
    private EmbeddingStoreConfigDoc embeddingStore;

    /**
     * LLM 配置列表
     */
    private List<LlmConfigDoc> llms;

    /**
     * 重排序模型配置
     */
    private RerankingConfigDoc reranking;

    /**
     * 内容存储配置 (支持 snake_case: content_store)
     */
    @JsonProperty("content_store")
    @Field("content_store")
    private ContentStoreConfigDoc contentStore;

    /**
     * 智能代理配置列表
     */
    private List<AgentConfigDoc> agents;

    /**
     * 创建时间
     */
    @CreatedDate
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    @LastModifiedDate
    private LocalDateTime updatedAt;

    // ==================== 嵌套配置文档类 ====================

    /**
     * 数据库配置文档
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DatabaseConfigDoc {
        private String provider;
        private Map<String, Object> configuration;
    }

    /**
     * 嵌入模型配置文档
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EmbeddingConfigDoc {
        private String provider;
        private Map<String, Object> configuration;
    }

    /**
     * 嵌入存储配置文档
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EmbeddingStoreConfigDoc {
        private String provider;
        private Map<String, Object> configuration;
    }

    /**
     * LLM 配置文档
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class LlmConfigDoc {
        private String name;
        private String provider;
        private Map<String, Object> configuration;
    }

    /**
     * 重排序模型配置文档
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RerankingConfigDoc {
        private String provider;
        private Map<String, Object> configuration;
    }

    /**
     * 内容存储配置文档
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ContentStoreConfigDoc {
        private String provider;
        private Map<String, Object> configuration;
    }

    /**
     * 智能代理配置文档
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AgentConfigDoc {
        private String name;
        private String description;
        private String provider;
        private Map<String, Object> configuration;
    }

}
