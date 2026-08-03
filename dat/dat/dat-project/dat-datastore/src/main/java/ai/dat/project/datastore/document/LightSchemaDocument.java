package ai.dat.project.datastore.document;

import ai.dat.core.contentstore.data.LightSchema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Light Schema MongoDB 文档
 * 将生成的 Light Schema 永久存储在 MongoDB 中
 * 
 * @Author DAT Team
 * @Date 2026/1/7
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "light_schemas")
@CompoundIndex(name = "proj_ds_table", def = "{'projectId': 1, 'datasourceId': 1, 'tableName': 1}", unique = true)
public class LightSchemaDocument {

    @Id
    private String id;

    /**
     * 项目 ID
     */
    private String projectId;

    /**
     * 数据源 ID
     */
    private String datasourceId;

    /**
     * 表名
     */
    private String tableName;

    /**
     * Light Schema 详细内容
     */
    private LightSchema schema;
}
