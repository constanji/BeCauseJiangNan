package ai.dat.core.index.data;

/**
 * 指标问数的查询类型,用于决定 SQL SELECT 字段白名单与查询形态。
 *
 * <ul>
 *   <li>{@link #STANDARD} 通用指标查询,返回 24 字段(index_number/standard_name/data_dt/...)。</li>
 *   <li>{@link #RANKING}  机构排名查询,返回 8 字段(brchna/org_code/data_dt/...),
 *                         触发关键词如:排名、前 N、降序、升序、最高、最低。</li>
 * </ul>
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
public enum QueryKind {
    STANDARD,
    ORG_AGGREGATION,
    RANKING
}
