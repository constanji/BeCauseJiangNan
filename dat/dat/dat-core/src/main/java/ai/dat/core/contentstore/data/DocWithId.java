package ai.dat.core.contentstore.data;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.NonNull;

/**
 * 带 ID 的业务知识文档
 * 用于返回给前端，支持根据 ID 进行删除操作
 *
 * @Author DAT Team
 * @Date 2025/12/31
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class DocWithId {
    @NonNull
    private final String id;

    @NonNull
    private final String content;

    @JsonCreator
    public DocWithId(@JsonProperty("id") @NonNull String id,
                     @JsonProperty("content") @NonNull String content) {
        this.id = id;
        this.content = content;
    }

    public static DocWithId from(@NonNull String id, @NonNull String content) {
        return new DocWithId(id, content);
    }
}
