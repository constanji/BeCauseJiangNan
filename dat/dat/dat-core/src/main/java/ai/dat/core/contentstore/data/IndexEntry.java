package ai.dat.core.contentstore.data;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.NonNull;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 指标库条目。
 * <p>
 * 由数管/业务方通过 Excel 导入,每条对应一个业务指标。检索阶段用于将用户自然语言
 * 中的"在编人数""各项存款余额"等词,精确映射到唯一的 {@code indexNumber},供 SQL
 * 生成阶段作为 {@code index_number IN (...)} 的候选集。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Getter
@JsonInclude(JsonInclude.Include.NON_NULL)
public class IndexEntry {

    /** 指标编码,例如 KPI0001。同一项目内唯一。 */
    @NonNull
    private final String indexNumber;

    /** 指标标准名称,例如 各项存款余额。 */
    @NonNull
    private final String standardName;

    /** 指标别名列表,例如 [存款余额]。可能为空列表。 */
    @NonNull
    private final List<String> aliases;

    /**
     * 指标来源/口径。
     * 1=人行口径,2=银监口径,3=省联社口径;对应 kpi 表 cal01/cal02/cal03 标志位。
     * 可为 null 表示未指定。
     */
    private final Integer source;

    /**
     * 指标频度,例如 日/月/旬/季。可为 null 表示未指定。
     */
    private final String frequency;

    @JsonCreator
    private IndexEntry(@JsonProperty("indexNumber") @NonNull String indexNumber,
                       @JsonProperty("standardName") @NonNull String standardName,
                       @JsonProperty("aliases") List<String> aliases,
                       @JsonProperty("source") Integer source,
                       @JsonProperty("frequency") String frequency) {
        this.indexNumber = indexNumber;
        this.standardName = standardName;
        this.aliases = aliases == null ? Collections.emptyList() : new ArrayList<>(aliases);
        this.source = source;
        this.frequency = frequency;
    }

    public static IndexEntry from(@NonNull String indexNumber,
                                  @NonNull String standardName,
                                  List<String> aliases,
                                  Integer source,
                                  String frequency) {
        return new IndexEntry(indexNumber, standardName, aliases, source, frequency);
    }
}
