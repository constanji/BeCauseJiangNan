package ai.dat.core.contentstore.data;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * kpi_info 数据源表行 DTO。
 * <p>对应数据库表 kpi_info 的字段结构，用于从数据源导入指标库。
 * 一行可能展开为多条 {@link IndexEntry}（每个口径一条）。
 *
 * <p>字段命名兼容两套约定：早期通用 {@code kpi_info} 命名(kpi_code/kpi_name/...)，
 * 以及后来项目内统一采用的 {@code index_number}/{@code standard_name} 命名(与
 * {@code IndexColumnWhitelist}、指标问数 SQL 生成、Excel 指标库导入保持一致)。
 * {@link #fromRow} / {@link #hasRequiredColumns} 按下面的别名表做兼容匹配，
 * 避免"从数据源表导入指标库"只认旧命名、跟实际业务表结构对不上。
 *
 * @Author DAT Team
 * @Date 2026/6/23
 */
@Getter
public class KpiInfoRow {

    private static final List<String> CODE_ALIASES = List.of("index_number", "kpi_code");
    private static final List<String> NAME_ALIASES = List.of("standard_name", "kpi_name");
    private static final List<String> FREQ_ALIASES = List.of("basic_frequency", "frequency", "kpi_freq");
    private static final List<String> DESC_ALIASES = List.of("business_meaning", "kpi_desc");
    private static final List<String> RULE_ALIASES = List.of("calculation_method", "kpi_rule");
    private static final List<String> ISPBC_ALIASES = List.of("cal01", "kpi_ispbc");
    private static final List<String> ISCBCR_ALIASES = List.of("cal02", "kpi_iscbcr");
    private static final List<String> ISRCCU_ALIASES = List.of("cal03", "kpi_isrccu");
    private static final List<String> DEPTMT_ALIASES = List.of("depname", "kpi_deptmt");
    private static final List<String> REMARK_ALIASES = List.of("remark", "kpi_remark");
    private static final List<String> CATEGORY_ALIASES = List.of("index_type", "kpi_category");
    private static final List<String> RELATION_ALIASES = List.of("index_number_rel", "kpi_relation");

    private final String kpiCode;
    private final String kpiName;
    private final String kpiFreq;
    private final String kpiDesc;
    private final String kpiRule;
    private final boolean kpiIspbc;
    private final boolean kpiIscbcr;
    private final boolean kpiIsrccu;
    private final String kpiDeptmt;
    private final String kpiRemark;
    private final String kpiCategory;
    private final String kpiRelation;

    @JsonCreator
    public KpiInfoRow(
            @JsonProperty("kpi_code") String kpiCode,
            @JsonProperty("kpi_name") String kpiName,
            @JsonProperty("kpi_freq") String kpiFreq,
            @JsonProperty("kpi_desc") String kpiDesc,
            @JsonProperty("kpi_rule") String kpiRule,
            @JsonProperty("kpi_ispbc") Boolean kpiIspbc,
            @JsonProperty("kpi_iscbcr") Boolean kpiIscbcr,
            @JsonProperty("kpi_isrccu") Boolean kpiIsrccu,
            @JsonProperty("kpi_deptmt") String kpiDeptmt,
            @JsonProperty("kpi_remark") String kpiRemark,
            @JsonProperty("kpi_category") String kpiCategory,
            @JsonProperty("kpi_relation") String kpiRelation) {
        this.kpiCode = kpiCode;
        this.kpiName = kpiName;
        this.kpiFreq = kpiFreq;
        this.kpiDesc = kpiDesc;
        this.kpiRule = kpiRule;
        this.kpiIspbc = kpiIspbc != null && kpiIspbc;
        this.kpiIscbcr = kpiIscbcr != null && kpiIscbcr;
        this.kpiIsrccu = kpiIsrccu != null && kpiIsrccu;
        this.kpiDeptmt = kpiDeptmt;
        this.kpiRemark = kpiRemark;
        this.kpiCategory = kpiCategory;
        this.kpiRelation = kpiRelation;
    }

    /**
     * 口径名称后缀。
     */
    private static final String PBOC_SUFFIX = "(人行口径)";
    private static final String CBRC_SUFFIX = "(银监口径)";
    private static final String RCC_SUFFIX = "(省联社口径)";

    /** 源常量对齐 IndexEntry.source */
    public static final int SOURCE_PBOC = 1;
    public static final int SOURCE_CBRC = 2;
    public static final int SOURCE_RCC = 3;

    /**
     * 从 kpi_name 中提取基础名称（去掉可能已存在的口径后缀）。
     */
    private String baseName() {
        String name = kpiName;
        if (name == null) return "";
        for (String suffix : new String[]{PBOC_SUFFIX, CBRC_SUFFIX, RCC_SUFFIX, "(监管口径)", "(人行)", "(银监)", "(省联社)"}) {
            if (name.endsWith(suffix)) {
                name = name.substring(0, name.length() - suffix.length()).trim();
            }
        }
        return name;
    }

    /**
     * 从 kpi_name 推导别名（去掉口径后缀，提取核心关键词作为别名）。
     */
    private List<String> deriveAliases() {
        List<String> aliases = new ArrayList<>();
        String base = baseName();
        if (!base.equals(kpiName)) {
            aliases.add(base);
        }
        // 用 kpi_category 作为别名补充
        if (kpiCategory != null && !kpiCategory.isBlank()) {
            aliases.add(kpiCategory);
        }
        return aliases;
    }

    /**
     * 将本行展开为多条 IndexEntry（每个口径一条）。
     * <p>如果没有任何口径 flag 为 true，则生成一条 source=null 的基础条目。
     */
    public List<IndexEntry> toIndexEntries() {
        List<IndexEntry> entries = new ArrayList<>();
        String base = baseName();
        List<String> aliases = deriveAliases();

        // 无口径 → 基础条目
        if (!kpiIspbc && !kpiIscbcr && !kpiIsrccu) {
            entries.add(IndexEntry.from(kpiCode, base, aliases, null, kpiFreq));
            return entries;
        }
        // 有人行口径
        if (kpiIspbc) {
            entries.add(IndexEntry.from(kpiCode, base + PBOC_SUFFIX, aliases, SOURCE_PBOC, kpiFreq));
        }
        // 有银监口径
        if (kpiIscbcr) {
            entries.add(IndexEntry.from(kpiCode, base + CBRC_SUFFIX, aliases, SOURCE_CBRC, kpiFreq));
        }
        // 有省联社口径
        if (kpiIsrccu) {
            entries.add(IndexEntry.from(kpiCode, base + RCC_SUFFIX, aliases, SOURCE_RCC, kpiFreq));
        }
        return entries;
    }

    // ─── 表结构校验 / 行解析(命名兼容) ──────────────────────────────────

    /**
     * 判断给定列名集合是否满足"必填字段都存在"，兼容 kpi_code/index_number
     * 与 kpi_name/standard_name 两套命名，大小写不敏感。
     */
    public static boolean hasRequiredColumns(Collection<String> columnNames) {
        if (columnNames == null) return false;
        Set<String> lower = new LinkedHashSet<>();
        for (String name : columnNames) {
            if (name != null) lower.add(name.toLowerCase());
        }
        return containsAny(lower, CODE_ALIASES) && containsAny(lower, NAME_ALIASES);
    }

    /** 缺失必填字段时给用户的提示文案(同时列出两套命名，便于对照实际表结构)。 */
    public static String missingColumnsMessage() {
        return "表结构不符合指标库导入规范，缺少必填字段 index_number/kpi_code 或 standard_name/kpi_name";
    }

    /**
     * 从实际列名中解析出用作去重键的"指标编码"列(index_number 或 kpi_code)，
     * 大小写不敏感，返回列的原始大小写写法；找不到返回 null。
     * <p>指标源表(如 kpi_result_ctcx)通常是按期快照的宽表——同一个指标编码
     * 在不同 data_dt 各有一行，直接 {@code SELECT *} 会把全部历史期数都拉出来。
     * 调用方应按此列去重、只取最新一期，而不是整表原样读入。
     */
    public static String resolveCodeColumn(Collection<String> actualColumnNames) {
        return resolveColumn(actualColumnNames, CODE_ALIASES);
    }

    /**
     * 从实际列名中筛出"指标定义相关"的列(两套命名都算)，用于替代 {@code SELECT *}，
     * 避免把源表里跟指标定义无关的列(尤其是宽表里体积大的列)一起搬进内存。
     * 返回列表保留原始大小写、按表里出现的顺序。
     */
    public static List<String> resolveRelevantColumns(Collection<String> actualColumnNames) {
        if (actualColumnNames == null) return List.of();
        List<List<String>> allAliasGroups = List.of(
                CODE_ALIASES, NAME_ALIASES, FREQ_ALIASES, DESC_ALIASES, RULE_ALIASES,
                ISPBC_ALIASES, ISCBCR_ALIASES, ISRCCU_ALIASES, DEPTMT_ALIASES,
                REMARK_ALIASES, CATEGORY_ALIASES, RELATION_ALIASES);
        Set<String> wanted = new LinkedHashSet<>();
        for (List<String> group : allAliasGroups) {
            for (String alias : group) {
                wanted.add(alias.toLowerCase());
            }
        }
        List<String> result = new ArrayList<>();
        for (String actual : actualColumnNames) {
            if (actual != null && wanted.contains(actual.toLowerCase())) {
                result.add(actual);
            }
        }
        return result;
    }

    private static String resolveColumn(Collection<String> actualColumnNames, List<String> aliases) {
        if (actualColumnNames == null) return null;
        for (String alias : aliases) {
            for (String actual : actualColumnNames) {
                if (actual != null && actual.equalsIgnoreCase(alias)) {
                    return actual;
                }
            }
        }
        return null;
    }

    /**
     * 从一行查询结果(列名 → 值)按别名表解析为 {@link KpiInfoRow}。
     * 用于"从数据源表导入指标库"，兼容 kpi_code/kpi_name 旧命名与
     * index_number/standard_name 新命名。
     */
    public static KpiInfoRow fromRow(Map<String, Object> row) {
        return new KpiInfoRow(
                str(row, CODE_ALIASES), str(row, NAME_ALIASES), str(row, FREQ_ALIASES),
                str(row, DESC_ALIASES), str(row, RULE_ALIASES),
                bool(row, ISPBC_ALIASES), bool(row, ISCBCR_ALIASES), bool(row, ISRCCU_ALIASES),
                str(row, DEPTMT_ALIASES), str(row, REMARK_ALIASES),
                str(row, CATEGORY_ALIASES), str(row, RELATION_ALIASES));
    }

    private static boolean containsAny(Set<String> lowerColumnNames, List<String> aliases) {
        for (String alias : aliases) {
            if (lowerColumnNames.contains(alias.toLowerCase())) return true;
        }
        return false;
    }

    private static String str(Map<String, Object> row, List<String> keys) {
        Object v = firstNonNull(row, keys);
        return v != null ? v.toString() : null;
    }

    private static Boolean bool(Map<String, Object> row, List<String> keys) {
        Object v = firstNonNull(row, keys);
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() == 1;
        String s = v.toString().trim();
        return "1".equals(s) || "true".equalsIgnoreCase(s);
    }

    /** 先按原样键匹配，再按小写兜底匹配，取第一个非空值。 */
    private static Object firstNonNull(Map<String, Object> row, List<String> keys) {
        if (row == null) return null;
        for (String key : keys) {
            Object v = row.get(key);
            if (v != null) return v;
        }
        for (Map.Entry<String, Object> e : row.entrySet()) {
            if (e.getKey() == null || e.getValue() == null) continue;
            String lowerKey = e.getKey().toLowerCase();
            for (String key : keys) {
                if (lowerKey.equals(key.toLowerCase())) return e.getValue();
            }
        }
        return null;
    }
}
