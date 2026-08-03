package ai.dat.core.index.data;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * LLM 意图分类返回的日期意图（抽象的三维结构）。
 * <p>由 {@link DateIntentExpander} 展开为具体的 {@link DateScenario} + 日期值列表。
 *
 * <p>三维度:
 * <ul>
 *   <li>{@code anchorType}: 时间锚点的形态 (NONE/EXACT/LIST/RANGE/RELATIVE_WINDOW)</li>
 *   <li>锚点字段: 根据 anchorType 填充其中一组</li>
 *   <li>{@code granularity}: 用户想要锚点内的哪种时间点 (NONE/DAILY/MONTH_END/QUARTER_END/...)</li>
 * </ul>
 *
 * <p>这样 prompt 不需要枚举所有"X到Y/X每月末/上半年月末/近N个月月末"等组合,
 * LLM 只输出抽象结构, Java 端做笛卡尔展开。
 *
 * @Author DAT Team
 * @Date 2026/6/24
 */
@Data
@NoArgsConstructor
public class DateIntent {

    public enum AnchorType { NONE, EXACT, LIST, RANGE, RELATIVE_WINDOW }

    public enum Granularity { NONE, DAILY, TEN_DAY, MONTH_END, QUARTER_END, YEAR_END }

    public enum WindowUnit { day, month, quarter, year }

    @JsonProperty("anchor_type")
    @com.fasterxml.jackson.annotation.JsonAlias("anchorType")
    private AnchorType anchorType = AnchorType.NONE;

    /** EXACT 时填充 (yyyy-MM-dd) */
    @JsonProperty("exact_date")
    @com.fasterxml.jackson.annotation.JsonAlias("exactDate")
    private String exactDate;

    /** LIST 时填充 (yyyy-MM-dd 或 yyyy-MM) */
    @JsonProperty("list_dates")
    @com.fasterxml.jackson.annotation.JsonAlias("listDates")
    private List<String> listDates;

    /** RANGE 时填充 */
    @JsonProperty("range_start")
    @com.fasterxml.jackson.annotation.JsonAlias("rangeStart")
    private String rangeStart;

    @JsonProperty("range_end")
    @com.fasterxml.jackson.annotation.JsonAlias("rangeEnd")
    private String rangeEnd;

    /** RELATIVE_WINDOW 时填充 */
    @JsonProperty("window_unit")
    @com.fasterxml.jackson.annotation.JsonAlias("windowUnit")
    private WindowUnit windowUnit;

    @JsonProperty("window_count")
    @com.fasterxml.jackson.annotation.JsonAlias("windowCount")
    private Integer windowCount;

    /** 用户希望锚点内的哪种时间点 */
    @JsonProperty("granularity")
    @com.fasterxml.jackson.annotation.JsonAlias("granularity")
    private Granularity granularity = Granularity.NONE;
}
