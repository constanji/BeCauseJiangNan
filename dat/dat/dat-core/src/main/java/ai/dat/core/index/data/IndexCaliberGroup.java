package ai.dat.core.index.data;

import ai.dat.core.contentstore.data.IndexEntry;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NonNull;

import java.util.List;

/**
 * 多口径指标分组。
 * <p>
 * 当用户问"各项存款余额"时,可能同时存在人行口径、银监口径等多个 {@link IndexEntry}
 * 共享同一 {@code standardName}。这种情况下,SQL 生成阶段会把所有口径的 index_number 都纳入
 * IN 候选,同时事件流附 SIMILAR_QUESTION 提示用户。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Getter
@Builder
@AllArgsConstructor
public class IndexCaliberGroup {

    /** 共享的指标标准名,例如 "各项存款余额"。 */
    @NonNull
    private final String standardName;

    /** 同一标准名下的全部口径条目(至少 2 条才会构成分组)。 */
    @NonNull
    private final List<IndexEntry> entries;
}
