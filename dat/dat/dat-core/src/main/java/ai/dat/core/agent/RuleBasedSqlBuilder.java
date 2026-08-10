package ai.dat.core.agent;

import ai.dat.core.contentstore.data.IndexEntry;
import ai.dat.core.index.data.DateScenario;
import ai.dat.core.index.data.IndexContext;
import ai.dat.core.index.data.QueryKind;
import lombok.extern.slf4j.Slf4j;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * 基于规则的 SQL 生成器，对齐 kpi.sql 中定义的全部 SQL 模板。
 * <p>所有方法均为纯函数，不依赖 Agent 状态，方便单独测试。
 */
@Slf4j
final class RuleBasedSqlBuilder {

    private static final List<String> INTERNAL_ORG_CODES = List.of("FR001", "FR002", "FR003", "00000", "A0000");

    /** 从 IndexContext 取币种编码，兼容 null / 空字符串，兜底 CN */
    private static String currCode(IndexContext ctx) {
        if (ctx == null || ctx.getCurrencyCode() == null || ctx.getCurrencyCode().isBlank()) {
            return "CN";
        }
        return ctx.getCurrencyCode();
    }

    enum RankingMode { TOP_N, FIRST, EXACT }

    private record RankingInfo(RankingMode mode, int rank, String whereClause) {}

    private RuleBasedSqlBuilder() {}

    static Optional<String> build(String question, String tableName, IndexContext indexContext, String dialect) {
        if (tableName == null || tableName.isBlank()) {
            return Optional.empty();
        }
        if (indexContext == null || !indexContext.isEnabled()) {
            return Optional.empty();
        }
        if (indexContext.getIndexCandidates() == null || indexContext.getIndexCandidates().isEmpty()) {
            return Optional.empty();
        }
        if (indexContext.getSelectColumnsWhitelist() == null || indexContext.getSelectColumnsWhitelist().isEmpty()) {
            return Optional.empty();
        }

        // 支持多指标查询：将所有候选指标的 index_number 用逗号分隔
        List<String> indexNumbers = indexContext.getIndexCandidates().stream()
                .map(IndexEntry::getIndexNumber)
                .filter(n -> n != null && !n.isBlank())
                .collect(Collectors.toList());
        if (indexNumbers.isEmpty()) {
            return Optional.empty();
        }
        String quotedIndexNumbers = indexNumbers.stream()
                .map(RuleBasedSqlBuilder::quoteSql)
                .collect(Collectors.joining("', '"));

        String selectColumns = indexContext.getSelectColumnsWhitelist().stream()
                .map(column -> "t." + column)
                .collect(Collectors.joining(", "));
        String orgCodes = joinQuoted(indexContext.getQueryOrgCodes());
        DateScenario dateScenario = indexContext.getDateScenario();

        // 同业指标(TY 开头)不走规则生成 SQL：规则模板的 SELECT 硬编码了同业 10 字段白名单,
        // 其中 primart_category / secondary_category 在线上表里可能缺失,会导致 SQL 执行失败。
        // 线上改由大模型基于实际表结构生成同业指标查询 SQL。
        if (indexNumbers.stream().allMatch(RuleBasedSqlBuilder::isInterbankIndex)) {
            return Optional.empty();
        }

        if (indexContext.getQueryKind() == QueryKind.RANKING) {
            // 排名查询只支持单指标
            if (indexNumbers.size() != 1) {
                return Optional.empty();
            }
            if (indexContext.getRankingOrgLevelLabel() == null || indexContext.getRankingOrgLevelLabel().isBlank()) {
                return Optional.empty();
            }
            return buildRankingSql(question, tableName, quoteSql(indexNumbers.get(0)), selectColumns, dateScenario, indexContext, dialect);
        }

        if (indexContext.getQueryOrgCodes() == null || indexContext.getQueryOrgCodes().isEmpty()) {
            return Optional.empty();
        }
        if (indexContext.getQueryKind() == QueryKind.ORG_AGGREGATION) {
            // 机构聚合查询支持多指标
            return buildOrgAggregationSql(tableName, quotedIndexNumbers, orgCodes, dateScenario, indexContext);
        }
        if (indexContext.getQueryKind() == QueryKind.STANDARD) {
            return buildStandardSql(tableName, quotedIndexNumbers, selectColumns, orgCodes, dateScenario, indexContext);
        }
        return Optional.empty();
    }

    /**
     * 同业指标编号以 "TY" 开头(导入脚本 generate_kpi_index_library.py PEER_CODE_START 起 TY00000001)。
     * 同业指标不走规则 SQL 生成(见 {@link #build} 开头的短路),这里仅保留编码判定供识别用。
     */
    private static boolean isInterbankIndex(String indexNumber) {
        return indexNumber != null && indexNumber.startsWith("TY");
    }

    // ─── STANDARD SQL ──────────────────────────────────────────────────────

    static Optional<String> buildStandardSql(String tableName, String quotedIndexNumbers, String selectColumns,
            String orgCodes, DateScenario dateScenario, IndexContext indexContext) {

        String cc = quoteSql(currCode(indexContext));

        // IN 场景：保留所有匹配日期，不做 MAX 聚合（对齐 kpi.sql Template #2）
        if (dateScenario == DateScenario.IN) {
            if (indexContext.getDateValues() == null || indexContext.getDateValues().isEmpty()) {
                return Optional.empty();
            }
            String dateInList = joinQuoted(indexContext.getDateValues());
            String sql = "WITH dd AS (SELECT index_number, org_code, data_dt FROM " + tableName + " "
                    + "WHERE index_number IN ('" + quotedIndexNumbers + "') AND curr_code = '" + cc + "' "
                    + "AND org_code IN (" + orgCodes + ") AND index_value IS NOT NULL "
                    + "AND data_dt IN (" + dateInList + ") "
                    + "GROUP BY index_number, org_code, data_dt) "
                    + "SELECT " + selectColumns + " FROM " + tableName + " t INNER JOIN dd "
                    + "ON t.index_number = dd.index_number AND t.org_code = dd.org_code AND t.data_dt = dd.data_dt "
                    + "WHERE t.curr_code = '" + cc + "' AND t.org_code IN (" + orgCodes + ")";
            return Optional.of(sql);
        }

        // NONE/EQ/BETWEEN 场景：使用 MAX(data_dt) 取最新
        String dateFilterInCte = "";
        if (dateScenario != DateScenario.NONE) {
            Optional<String> dateClause = buildDateWhereClause(dateScenario, indexContext);
            if (dateClause.isEmpty()) {
                return Optional.empty();
            }
            dateFilterInCte = "AND " + dateClause.get().replace("t.", "");
        }

        String sql = "WITH dd AS (SELECT index_number, org_code, MAX(data_dt) data_dt FROM " + tableName + " "
                + "WHERE index_number IN ('" + quotedIndexNumbers + "') AND curr_code = '" + cc + "' "
                + "AND org_code IN (" + orgCodes + ") AND index_value IS NOT NULL "
                + dateFilterInCte + " "
                + "GROUP BY index_number, org_code) "
                + "SELECT " + selectColumns + " FROM " + tableName + " t INNER JOIN dd "
                + "ON t.index_number = dd.index_number AND t.org_code = dd.org_code AND t.data_dt = dd.data_dt "
                + "WHERE t.curr_code = '" + cc + "' AND t.org_code IN (" + orgCodes + ")";
        return Optional.of(sql);
    }

    static Optional<String> buildOrgAggregationSql(String tableName, String quotedIndexNumber,
            String orgCodes, DateScenario dateScenario, IndexContext indexContext) {
        String cc = quoteSql(currCode(indexContext));
        // 求差或求比：只支持2个机构
        if (indexContext.getOrgAggregationMode() == IndexContext.OrgAggregationMode.SUBTRACT) {
            return buildSubtractionSql(tableName, quotedIndexNumber, orgCodes, dateScenario, indexContext);
        }
        if (indexContext.getOrgAggregationMode() == IndexContext.OrgAggregationMode.DIVIDE) {
            return buildDivisionSql(tableName, quotedIndexNumber, orgCodes, dateScenario, indexContext);
        }
        // 分组对比
        if (indexContext.getOrgAggregationMode() == IndexContext.OrgAggregationMode.GROUP_BY_ORG) {
            return buildOrgComparisonSql(tableName, quotedIndexNumber, orgCodes, dateScenario, indexContext);
        }
        // 意图不明确 — 不猜测，跳过规则模板让大模型兜底
        if (indexContext.getOrgAggregationMode() == IndexContext.OrgAggregationMode.UNCERTAIN) {
            return Optional.empty();
        }
        // 求和（默认 NONE / SUM_CHILDREN）：每个机构取各自最新 data_dt，然后 SUM 求和
        String sumDateFilterInCte = "";
        if (dateScenario != DateScenario.NONE) {
            Optional<String> dateClause = buildDateWhereClause(dateScenario, indexContext);
            if (dateClause.isEmpty()) {
                return Optional.empty();
            }
            sumDateFilterInCte = "AND " + dateClause.get().replace("t.", "");
        }
        // GROUP BY index_number, org_code：每个机构可能有不同最新日期
        String sql = "WITH latest_data AS (SELECT index_number, org_code, MAX(data_dt) AS data_dt FROM " + tableName + " "
                + "WHERE index_number IN ('" + quotedIndexNumber + "') AND curr_code = '" + cc + "' "
                + "AND org_code IN (" + orgCodes + ") AND index_value IS NOT NULL "
                + sumDateFilterInCte + " GROUP BY index_number, org_code), "
                + "filtered_result AS (SELECT t.data_dt, t.standard_name, t.mea_unit, t.index_data_sources_id, "
                + "SUM(t.index_value) AS jhzb_value "
                + "FROM " + tableName + " t INNER JOIN latest_data dd "
                + "ON t.index_number = dd.index_number AND t.org_code = dd.org_code AND t.data_dt = dd.data_dt "
                + "AND t.curr_code = '" + cc + "' "
                + "WHERE t.index_number IN ('" + quotedIndexNumber + "') AND t.org_code IN (" + orgCodes + ") "
                + "GROUP BY t.data_dt, t.standard_name, t.mea_unit, t.index_data_sources_id) "
                + "SELECT data_dt, standard_name, mea_unit, index_data_sources_id, jhzb_value "
                + "FROM filtered_result WHERE jhzb_value IS NOT NULL";
        return Optional.of(sql);
    }

    private static Optional<String> buildOrgComparisonSql(String tableName, String quotedIndexNumber,
            String orgCodes, DateScenario dateScenario, IndexContext indexContext) {
        String cc = quoteSql(currCode(indexContext));
        String cmpDateFilterInCte = "";
        if (dateScenario != DateScenario.NONE) {
            Optional<String> dateClause = buildDateWhereClause(dateScenario, indexContext);
            if (dateClause.isEmpty()) {
                return Optional.empty();
            }
            cmpDateFilterInCte = "AND " + dateClause.get().replace("t.", "");
        }
        String sql = "WITH dd AS (SELECT index_number, org_code, MAX(data_dt) data_dt FROM " + tableName + " "
                + "WHERE index_number IN ('" + quotedIndexNumber + "') AND curr_code = '" + cc + "' "
                + "AND org_code IN (" + orgCodes + ") AND index_value IS NOT NULL "
                + cmpDateFilterInCte + " GROUP BY index_number, org_code) "
                + "SELECT t.org_code, t.brchna, t.data_dt, t.standard_name, t.index_value, t.mea_unit, "
                + "t.index_data_sources_id "
                + "FROM " + tableName + " t INNER JOIN dd ON t.index_number = dd.index_number "
                + "AND t.org_code = dd.org_code AND t.data_dt = dd.data_dt "
                + "WHERE t.curr_code = '" + cc + "' "
                + "ORDER BY t.org_code";
        return Optional.of(sql);
    }

    // ─── SUBTRACTION SQL (A - B)：对齐 kpi.sql 聚合类查询模板（相减）─────────

    static Optional<String> buildSubtractionSql(String tableName, String quotedIndexNumber,
            String orgCodes, DateScenario dateScenario, IndexContext indexContext) {
        String cc = quoteSql(currCode(indexContext));
        // 解析两个机构编码
        String[] orgArray = orgCodes.replace("'", "").split(",\\s*");
        if (orgArray.length != 2) {
            return Optional.empty();  // 只支持2个机构
        }
        String leftOrg = "'" + orgArray[0].trim() + "'";
        String rightOrg = "'" + orgArray[1].trim() + "'";

        // GROUP BY index_number, org_code：每个机构取各自最新 data_dt
        // diff_calc 用 SUM(CASE WHEN org_code = 'A' THEN ...) 对两个机构做差
        String subDateFilterInCte = "";
        if (dateScenario != DateScenario.NONE) {
            Optional<String> dateClause = buildDateWhereClause(dateScenario, indexContext);
            if (dateClause.isEmpty()) {
                return Optional.empty();
            }
            subDateFilterInCte = "AND " + dateClause.get().replace("t.", "");
        }
        String sql = "WITH latest_data AS (SELECT index_number, org_code, MAX(data_dt) AS data_dt FROM " + tableName + " "
                + "WHERE index_number IN ('" + quotedIndexNumber + "') AND curr_code = '" + cc + "' "
                + "AND org_code IN (" + orgCodes + ") AND index_value IS NOT NULL "
                + subDateFilterInCte + " GROUP BY index_number, org_code), "
                + "org_values AS (SELECT t.data_dt, t.org_code, t.standard_name, t.mea_unit, t.index_data_sources_id, "
                + "t.index_value FROM " + tableName + " t INNER JOIN latest_data dd "
                + "ON t.index_number = dd.index_number AND t.org_code = dd.org_code AND t.data_dt = dd.data_dt AND t.curr_code = '" + cc + "' "
                + "WHERE t.index_number IN ('" + quotedIndexNumber + "') AND t.org_code IN (" + orgCodes + ")), "
                + "diff_calc AS (SELECT MAX(data_dt) AS data_dt, MAX(standard_name) AS standard_name, "
                + "MAX(mea_unit) AS mea_unit, MAX(index_data_sources_id) AS index_data_sources_id, "
                + "COALESCE(SUM(CASE WHEN org_code = " + leftOrg + " THEN index_value ELSE 0 END), 0) "
                + "- COALESCE(SUM(CASE WHEN org_code = " + rightOrg + " THEN index_value ELSE 0 END), 0) AS jhzb_value "
                + "FROM org_values) "
                + "SELECT data_dt, standard_name, mea_unit, index_data_sources_id, jhzb_value FROM diff_calc";
        return Optional.of(sql);
    }

    // ─── DIVISION SQL (A / B)：对齐 kpi.sql 聚合类查询模板（求比）────────────

    static Optional<String> buildDivisionSql(String tableName, String quotedIndexNumber,
            String orgCodes, DateScenario dateScenario, IndexContext indexContext) {
        String cc = quoteSql(currCode(indexContext));
        // 解析两个机构编码
        String[] orgArray = orgCodes.replace("'", "").split(",\\s*");
        if (orgArray.length != 2) {
            return Optional.empty();  // 只支持2个机构
        }
        String leftOrg = "'" + orgArray[0].trim() + "'";
        String rightOrg = "'" + orgArray[1].trim() + "'";

        // GROUP BY index_number, org_code：每个机构取各自最新 data_dt
        // ratio_calc 用 SUM(CASE WHEN org_code = 'A' THEN ...) 对两个机构求比
        String divDateFilterInCte = "";
        if (dateScenario != DateScenario.NONE) {
            Optional<String> dateClause = buildDateWhereClause(dateScenario, indexContext);
            if (dateClause.isEmpty()) {
                return Optional.empty();
            }
            divDateFilterInCte = "AND " + dateClause.get().replace("t.", "");
        }
        String sql = "WITH latest_data AS (SELECT index_number, org_code, MAX(data_dt) AS data_dt FROM " + tableName + " "
                + "WHERE index_number IN ('" + quotedIndexNumber + "') AND curr_code = '" + cc + "' "
                + "AND org_code IN (" + orgCodes + ") AND index_value IS NOT NULL "
                + divDateFilterInCte + " GROUP BY index_number, org_code), "
                + "org_values AS (SELECT t.data_dt, t.org_code, t.standard_name, t.mea_unit, t.index_data_sources_id, "
                + "t.index_value FROM " + tableName + " t INNER JOIN latest_data dd "
                + "ON t.index_number = dd.index_number AND t.org_code = dd.org_code AND t.data_dt = dd.data_dt AND t.curr_code = '" + cc + "' "
                + "WHERE t.index_number IN ('" + quotedIndexNumber + "') AND t.org_code IN (" + orgCodes + ")), "
                + "ratio_calc AS (SELECT MAX(data_dt) AS data_dt, MAX(standard_name) AS standard_name, "
                + "'%' AS mea_unit, MAX(index_data_sources_id) AS index_data_sources_id, "
                + "ROUND(COALESCE(SUM(CASE WHEN org_code = " + leftOrg + " THEN index_value ELSE 0 END), 0) * 100.0 "
                + "/ NULLIF(COALESCE(SUM(CASE WHEN org_code = " + rightOrg + " THEN index_value ELSE 0 END), 0), 0), 2) AS jhzb_value "
                + "FROM org_values) "
                + "SELECT data_dt, standard_name, mea_unit, index_data_sources_id, jhzb_value FROM ratio_calc";
        return Optional.of(sql);
    }

    // ─── RANKING SQL ──────────────────────────────────────────────────────

    static Optional<String> buildRankingSql(String question, String tableName, String quotedIndexNumber, String selectColumns,
            DateScenario dateScenario, IndexContext indexContext, String dialect) {
        String cc = quoteSql(currCode(indexContext));
        // 优先使用 IndexContext 中 LLM 提取的排名信息，fallback 到正则解析
        String orderDirection = indexContext.getRankingOrder() != null && !indexContext.getRankingOrder().isBlank()
                ? indexContext.getRankingOrder() : detectRankingOrderDirection(question);
        RankingInfo info = buildRankingInfoFromContext(indexContext, question);
        log.info("buildRankingSql: rankingLimit={}, rankingOrder={}, whereClause={}",
                indexContext.getRankingLimit(), orderDirection, info.whereClause());
        String internalOrgFilter = joinQuoted(INTERNAL_ORG_CODES);
        String orgLevelLabel = quoteSql(indexContext.getRankingOrgLevelLabel());

        // 根据标签判断机构过滤条件
        // - "全行"：不使用正则过滤（查询所有机构类型）
        // - "分行"：使用正则过滤分行
        // - "支行"：使用正则过滤支行
        // 注意：PostgreSQL 使用 ~ 而不是 REGEXP
        boolean isPostgreSQL = dialect != null && dialect.toLowerCase().contains("postgresql");
        String orgRegexpFilter;
        if ("全行".equals(indexContext.getRankingOrgLevelLabel())) {
            orgRegexpFilter = "";
        } else if ("分行".equals(indexContext.getRankingOrgLevelLabel())) {
            orgRegexpFilter = isPostgreSQL
                    ? "AND t.org_code ~ '^[A-Z]' "
                    : "AND t.org_code REGEXP '^[A-Z]' ";
        } else {
            // 默认支行
            orgRegexpFilter = isPostgreSQL
                    ? "AND t.org_code ~ '^[0-9]' "
                    : "AND t.org_code REGEXP '^[0-9]' ";
        }

        String outerSelectColumns = selectColumns.replace("t.", "") + ", '" + orgLevelLabel + "' AS org_level, rn";

        // ── 无日期：CTE + JOIN（对齐 kpi.sql "查询机构 降序/升序" 模板）──
        if (dateScenario == DateScenario.NONE) {
            String sql = "WITH dd AS (SELECT index_number, MAX(data_dt) data_dt FROM " + tableName + " "
                    + "WHERE index_number IN ('" + quotedIndexNumber + "') AND curr_code = '" + cc + "' "
                    + "AND index_value IS NOT NULL GROUP BY index_number), "
                    + "ranked_orgs AS (SELECT t.*, DENSE_RANK() OVER (ORDER BY t.index_value " + orderDirection
                    + ") AS rn FROM " + tableName + " t INNER JOIN dd ON t.index_number = dd.index_number "
                    + "AND t.data_dt = dd.data_dt WHERE t.curr_code = '" + cc + "' "
                    + orgRegexpFilter
                    + "AND t.org_code NOT IN (" + internalOrgFilter + ")) "
                    + "SELECT " + outerSelectColumns + " FROM ranked_orgs WHERE " + info.whereClause();
            return Optional.of(sql);
        }

        // ── 有日期：无 CTE，直接在 ranked_orgs 中按日期过滤 ──
        // 对齐 kpi.sql "带日期模板"（情况A data_dt IN / 情况B BETWEEN）
        String dateFilter;
        switch (dateScenario) {
            case EQ:
            case IN:
                if (indexContext.getDateValues() == null || indexContext.getDateValues().isEmpty()) {
                    return Optional.empty();
                }
                dateFilter = "AND t.data_dt IN (" + joinQuoted(indexContext.getDateValues()) + ") ";
                break;
            case BETWEEN:
                if (indexContext.getDateRangeStart() == null || indexContext.getDateRangeEnd() == null) {
                    return Optional.empty();
                }
                dateFilter = "AND t.data_dt BETWEEN '" + quoteSql(indexContext.getDateRangeStart())
                        + "' AND '" + quoteSql(indexContext.getDateRangeEnd()) + "' ";
                break;
            default:
                return Optional.empty();
        }

        String sql = "WITH ranked_orgs AS (SELECT t.*, DENSE_RANK() OVER (ORDER BY t.index_value " + orderDirection
                + ") AS rn FROM " + tableName + " t "
                + "WHERE t.curr_code = '" + cc + "' "
                + orgRegexpFilter
                + "AND t.org_code NOT IN (" + internalOrgFilter + ") "
                + dateFilter
                + "AND t.index_number IN ('" + quotedIndexNumber + "')) "
                + "SELECT " + outerSelectColumns + " FROM ranked_orgs WHERE " + info.whereClause();
        return Optional.of(sql);
    }

    // ─── Date WHERE clause ────────────────────────────────────────────────

    static Optional<String> buildDateWhereClause(DateScenario dateScenario, IndexContext indexContext) {
        switch (dateScenario) {
            case EQ:
                if (indexContext.getDateValues() != null && !indexContext.getDateValues().isEmpty()) {
                    return Optional.of("t.data_dt = '" + quoteSql(indexContext.getDateValues().get(0)) + "'");
                }
                return Optional.empty();
            case IN:
                if (indexContext.getDateValues() != null && !indexContext.getDateValues().isEmpty()) {
                    return Optional.of("t.data_dt IN (" + joinQuoted(indexContext.getDateValues()) + ")");
                }
                return Optional.empty();
            case BETWEEN:
                if (indexContext.getDateRangeStart() != null && indexContext.getDateRangeEnd() != null) {
                    return Optional.of("t.data_dt BETWEEN '" + quoteSql(indexContext.getDateRangeStart()) +
                            "' AND '" + quoteSql(indexContext.getDateRangeEnd()) + "'");
                }
                return Optional.empty();
            default:
                return Optional.empty();
        }
    }

    // ─── Ranking detection ────────────────────────────────────────────────

    /**
     * 优先使用 IndexContext 中 LLM 提取的排名信息，fallback 到正则解析。
     */
    static RankingInfo buildRankingInfoFromContext(IndexContext indexContext, String question) {
        // 优先使用 LLM 意图分类提取的排名信息
        if (indexContext.getRankingLimit() != null && indexContext.getRankingLimit() > 0) {
            int limit = indexContext.getRankingLimit();
            // rankingLimit=1 时使用 "rn = 1"（精确匹配第一名，包括并列）
            // rankingLimit>1 时使用 "rn <= limit"（返回前 N 名）
            String whereClause = limit == 1 ? "rn = 1" : "rn <= " + limit;
            return new RankingInfo(limit == 1 ? RankingMode.FIRST : RankingMode.TOP_N, limit, whereClause);
        }
        // Fallback: 使用旧的正则解析逻辑
        return detectRankingInfo(question);
    }

    static String detectRankingOrderDirection(String question) {
        String text = question == null ? "" : question;
        if (text.contains("最低") || text.contains("最小") || text.contains("升序") || text.contains("倒数")) {
            return "ASC";
        }
        return "DESC";
    }

    static RankingInfo detectRankingInfo(String question) {
        String text = question == null ? "" : question;
        RankingMode mode = detectRankingMode(text);
        Integer detectedRank = detectRankingLimit(text);
        int rank = detectedRank != null ? detectedRank : 10;
        String whereClause = switch (mode) {
            case FIRST -> "rn = 1";
            case EXACT -> "rn = " + rank;
            default -> "rn <= " + rank;
        };
        return new RankingInfo(mode, rank, whereClause);
    }

    static RankingMode detectRankingMode(String text) {
        if (java.util.regex.Pattern.compile("第\\s*(一|二|三|四|五|六|七|八|九|十|\\d+)\\s*(名|位)").matcher(text).find()) {
            return RankingMode.EXACT;
        }
        if (text.contains("最高") || text.contains("最低") || text.contains("最大") || text.contains("最小")) {
            if (!java.util.regex.Pattern.compile("(最高|最低|最小|最大).*?\\d").matcher(text).find()
                    && !java.util.regex.Pattern.compile("前\\s*\\d").matcher(text).find()
                    && !java.util.regex.Pattern.compile("(最高|最低|最小|最大)\\s*(一|二|三|四|五|六|七|八|九|十)").matcher(text).find()) {
                return RankingMode.FIRST;
            }
        }
        return RankingMode.TOP_N;
    }

    static Integer detectRankingLimit(String text) {
        java.util.regex.Pattern[] patterns = new java.util.regex.Pattern[] {
                java.util.regex.Pattern.compile("前\\s*(\\d+)"),
                java.util.regex.Pattern.compile("(最高|最低|最小|最大).*?(\\d+)"),
                java.util.regex.Pattern.compile("第\\s*(\\d+)\\s*(名|位)"),
                java.util.regex.Pattern.compile("(\\d+)\\s*(个|家|条|名)"),
                java.util.regex.Pattern.compile("前\\s*(一|二|三|四|五|六|七|八|九|十)"),
                java.util.regex.Pattern.compile("(最高|最低|最小|最大)\\s*(一|二|三|四|五|六|七|八|九|十)\\s*(个|家|条|名)"),
                java.util.regex.Pattern.compile("前\\s*(一|二|三|四|五|六|七|八|九|十)\\s*(个|家|条|名)"),
                java.util.regex.Pattern.compile("第\\s*(一|二|三|四|五|六|七|八|九|十)\\s*(名|位)")
        };
        for (java.util.regex.Pattern pattern : patterns) {
            java.util.regex.Matcher matcher = pattern.matcher(text);
            if (matcher.find()) {
                String raw = null;
                for (int i = matcher.groupCount(); i >= 1; i--) {
                    String candidate = matcher.group(i);
                    Integer chineseNumber = parseChineseRankingNumber(candidate);
                    if (chineseNumber != null) {
                        return chineseNumber;
                    }
                    if (candidate != null && candidate.matches("\\d+")) {
                        raw = candidate;
                        break;
                    }
                }
                if (raw != null) {
                    try {
                        int value = Integer.parseInt(raw);
                        if (value > 0) {
                            return value;
                        }
                    } catch (NumberFormatException ignore) {
                    }
                }
            }
        }
        return null;
    }

    static Integer parseChineseRankingNumber(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        return switch (raw) {
            case "一" -> 1;
            case "二" -> 2;
            case "三" -> 3;
            case "四" -> 4;
            case "五" -> 5;
            case "六" -> 6;
            case "七" -> 7;
            case "八" -> 8;
            case "九" -> 9;
            case "十" -> 10;
            default -> null;
        };
    }

    static String joinQuoted(List<String> values) {
        return values.stream()
                .map(RuleBasedSqlBuilder::quoteSql)
                .map(value -> "'" + value + "'")
                .collect(Collectors.joining(", "));
    }

    static String quoteSql(String value) {
        return value == null ? "" : value.replace("'", "''");
    }
}
