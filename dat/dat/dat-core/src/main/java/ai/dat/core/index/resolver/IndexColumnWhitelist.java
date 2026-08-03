package ai.dat.core.index.resolver;

import java.util.List;

/**
 * 指标问数的 SELECT 字段白名单常量。
 * <p>由 {@code IndexContextResolver} 根据 {@code QueryKind} 选用,注入到 SQL 生成的提示词:
 * "MUST include ALL of these (no more, no less, in this order)"。
 *
 * <p>来自 kpi.sql 文档约定:
 * <ul>
 *   <li>{@link #STANDARD} 24 字段 — 通用指标查询;</li>
 *   <li>{@link #RANKING} 8 字段 — 机构排名查询(brchna/org_code 优先)。</li>
 * </ul>
 *
 * <p>同业指标(TY)不再有专用白名单:线上同业表缺 {@code primart_category} / {@code secondary_category},
 * 早期 10 字段同业白名单已移除,同业查询统一按 QueryKind 走 STANDARD/RANKING 白名单,
 * 由大模型基于实际表结构生成 SQL。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
public final class IndexColumnWhitelist {

    private IndexColumnWhitelist() {
    }

    /** 通用指标查询:24 字段。 */
    public static final List<String> STANDARD = List.of(
            "index_number", "standard_name", "data_dt", "org_code", "brchna",
            "curr_code", "mea_unit", "index_value",
            "yd_value", "yd_change_value", "yd_change_ratio",
            "m_begin_value", "m_begin_change_value", "m_begin_change_ratio",
            "q_begin_value", "q_begin_change_value", "q_begin_change_ratio",
            "y_begin_value", "y_begin_change_value", "y_begin_change_ratio",
            "ly_value", "ly_change_value", "ly_change_ratio",
            "index_data_sources_id", "kpi_freq"
    );

    /** 机构排名查询:8 字段。 */
    public static final List<String> RANKING = List.of(
            "brchna", "org_code", "data_dt", "standard_name",
            "index_value", "mea_unit", "index_data_sources_id", "kpi_freq"
    );
}
