package ai.dat.project.datastore.document;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * 单元格向量化跟踪文档。
 * 记录"哪个 (projectId, datasourceId) 下哪些表完成过单元格向量化"，
 * 用于 UI 快速展示"已向量化"状态，避免对向量库做全表扫。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "cell_tables")
@CompoundIndex(name = "proj_ds_table", def = "{'projectId': 1, 'datasourceId': 1, 'tableName': 1}", unique = true)
public class CellTableDocument {

    @Id
    private String id;

    private String projectId;

    private String datasourceId;

    private String tableName;

    /**
     * 最后一次向量化完成时间。
     */
    private Instant vectorizedAt;
}
