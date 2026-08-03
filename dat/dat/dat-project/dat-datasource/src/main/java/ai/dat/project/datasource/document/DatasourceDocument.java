package ai.dat.project.datasource.document;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * MongoDB 数据源文档模型
 * 管理数据库连接配置，每个数据源属于一个项目
 * 
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "datasources")
@CompoundIndexes({
    @CompoundIndex(name = "project_name_idx", def = "{'projectId': 1, 'name': 1}", unique = true)
})
public class DatasourceDocument {

    /**
     * 数据源唯一标识
     */
    @Id
    private String id;

    /**
     * 关联的项目ID
     */
    @Indexed
    private String projectId;

    /**
     * 数据源名称
     */
    private String name;

    /**
     * 数据源描述
     */
    private String description;

    /**
     * 数据源提供者类型
     * 例如: mysql, postgresql, oracle, duckdb
     */
    private String provider;

    /**
     * 数据源连接配置
     * 包含: url, username, password, timeout 等
     */
    private Map<String, Object> configuration;

    /**
     * 是否启用
     */
    @Builder.Default
    private Boolean enabled = true;

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

}
