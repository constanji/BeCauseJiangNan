package ai.dat.boot.data;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * @Author JunjieM
 * @Date 2025/7/16
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SchemaFileState {
    /**
     * 文件相对路径
     */
    private String relativePath;

    /**
     * 文件最后修改时间（毫秒时间戳）
     */
    private long lastModified;

    /**
     * 文件的MD5哈希值
     */
    private String md5Hash;

    /**
     * 问答SQL对的向量存储ID列表
     */
    @JsonProperty("sqlPairVectorIds")
    private List<String> questionSqlPairVectorIds = List.of();

    /**
     * 同义词对的向量存储ID列表
     */
    @JsonProperty("synonymPairVectorIds")
    private List<String> wordSynonymPairVectorIds = List.of();

    /**
     * 业务知识的向量存储ID列表
     */
    @JsonProperty("knowledgeVectorIds")
    private List<String> knowledgeVectorIds = List.of();
}