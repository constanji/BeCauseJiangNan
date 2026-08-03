package ai.dat.project.datastore.document;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import java.time.LocalDateTime;

/**
 * 全局配置文档
 * <p>用于存储系统级配置，如默认项目、默认数据源等。
 * 使用单例模式，固定 _id = "global" 确保全局唯一。
 *
 * @Author DAT Team
 * @Date 2026/06/16
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "global_config")
public class GlobalConfigDocument {

    /**
     * 固定 ID，确保全局唯一配置
     */
    @Id
    private String id = "global";

    /**
     * 默认项目 ID
     * <p>当问数接口（OpenAPI、ESB、MCP）未传入 project_id 时使用。
     */
    @Field("default_project_id")
    private String defaultProjectId;

    /**
     * 默认数据源 ID
     * <p>当问数接口未传入 datasource_id 时使用。
     */
    @Field("default_datasource_id")
    private String defaultDatasourceId;

    /**
     * 创建时间
     */
    @Field("created_at")
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    @Field("updated_at")
    private LocalDateTime updatedAt;
}
