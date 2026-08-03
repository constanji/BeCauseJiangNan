package ai.dat.core.contentstore.data;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.NonNull;

import java.util.List;

/**
 * 带 ID 的词与同义词对
 * 用于返回给前端，支持根据 ID 进行删除操作
 *
 * @Author DAT Team
 * @Date 2025/12/31
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class WordSynonymPairWithId {
    @NonNull
    private final String id;

    @NonNull
    private final String word;

    @NonNull
    private final List<String> synonyms;

    @JsonCreator
    public WordSynonymPairWithId(@JsonProperty("id") @NonNull String id,
                                  @JsonProperty("word") @NonNull String word,
                                  @JsonProperty("synonyms") @NonNull List<String> synonyms) {
        this.id = id;
        this.word = word;
        this.synonyms = synonyms;
    }

    public static WordSynonymPairWithId from(@NonNull String id, @NonNull WordSynonymPair pair) {
        return new WordSynonymPairWithId(id, pair.getWord(), pair.getSynonyms());
    }
}
