package ai.dat.core.contentstore.data;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.NonNull;

import java.util.Collections;
import java.util.List;

/**
 * 带 ID 的指标库条目。
 * 用于返回给前端,支持根据 ID 进行编辑/删除操作。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class IndexEntryWithId {

    @NonNull
    private final String id;

    @NonNull
    private final String indexNumber;

    @NonNull
    private final String standardName;

    @NonNull
    private final List<String> aliases;

    private final Integer source;

    private final String frequency;

    @JsonCreator
    public IndexEntryWithId(@JsonProperty("id") @NonNull String id,
                            @JsonProperty("indexNumber") @NonNull String indexNumber,
                            @JsonProperty("standardName") @NonNull String standardName,
                            @JsonProperty("aliases") List<String> aliases,
                            @JsonProperty("source") Integer source,
                            @JsonProperty("frequency") String frequency) {
        this.id = id;
        this.indexNumber = indexNumber;
        this.standardName = standardName;
        this.aliases = aliases == null ? Collections.emptyList() : List.copyOf(aliases);
        this.source = source;
        this.frequency = frequency;
    }

    public static IndexEntryWithId from(@NonNull String id, @NonNull IndexEntry entry) {
        return new IndexEntryWithId(id, entry.getIndexNumber(), entry.getStandardName(),
                entry.getAliases(), entry.getSource(), entry.getFrequency());
    }
}
