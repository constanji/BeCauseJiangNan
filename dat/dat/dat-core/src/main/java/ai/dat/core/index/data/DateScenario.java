package ai.dat.core.index.data;

/**
 * 用户提问中体现的日期场景,用于决定 SQL 中如何处理 {@code data_dt} 过滤。
 *
 * <ul>
 *   <li>{@link #NONE}    用户没提日期,取每个 index_number 最新 {@code MAX(data_dt)}。</li>
 *   <li>{@link #EQ}      用户给了一个具体日期,使用 {@code data_dt = 'xxx'}。</li>
 *   <li>{@link #IN}      用户列举多个具体日期,使用 {@code data_dt IN ('a','b',...)}。</li>
 *   <li>{@link #BETWEEN} 用户给了日期范围,使用 {@code data_dt BETWEEN ... AND ...}。</li>
 * </ul>
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
public enum DateScenario {
    NONE,
    EQ,
    IN,
    BETWEEN
}
