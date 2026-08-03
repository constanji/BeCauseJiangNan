package ai.dat.project.datastore.document;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

/**
 * 指标库条目的 MongoDB 文档。
 * <p>
 * 每条记录对应业务方上传的"指标库.xlsx"中的一行,按 {@code (projectId, indexNumber)} 唯一。
 * 用于指标问数请求中的指标候选检索(精确别名匹配 + 向量召回)。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "index_entries")
@CompoundIndex(name = "proj_index_num", def = "{'projectId': 1, 'indexNumber': 1}", unique = true)
public class IndexEntryDocument {

    @Id
    private String id;

    /** 所属项目 ID。 */
    private String projectId;

    /** 指标编码,例如 KPI0001。 */
    private String indexNumber;

    /** 指标标准名称。 */
    private String standardName;

    /** 指标别名列表(可空)。 */
    private List<String> aliases;

    /** 指标来源/口径:1=人行 2=银监 3=省联社。可为 null。 */
    private Integer source;

    /** 指标频度,例如 日/月/旬/季。可为 null。 */
    private String frequency;

    /** 最后一次写入时间(便于排查与排序)。 */
    private Instant updatedAt;
}
