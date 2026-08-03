package ai.dat.core.contentstore.data;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.NonNull;

/**
 * 带 ID 的问题与SQL对
 * 用于返回给前端，支持根据 ID 进行删除操作
 *
 * @Author DAT Team
 * @Date 2025/12/31
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class QuestionSqlPairWithId {
    @NonNull
    private final String id;

    @NonNull
    private final String question;

    @NonNull
    private final String sql;

    @JsonCreator
    public QuestionSqlPairWithId(@JsonProperty("id") @NonNull String id,
                                  @JsonProperty("question") @NonNull String question,
                                  @JsonProperty("sql") @NonNull String sql) {
        this.id = id;
        this.question = question;
        this.sql = sql;
    }

    public static QuestionSqlPairWithId from(@NonNull String id, @NonNull QuestionSqlPair pair) {
        return new QuestionSqlPairWithId(id, pair.getQuestion(), pair.getSql());
    }
}
