package ai.dat.core.index.data;

import ai.dat.core.contentstore.data.IndexEntry;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;

import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * 指标问数的请求级上下文。
 * <p>
 * 由 {@code IndexContextResolver} 在每次问数请求开始时构造,作为 attributes 通过
 * {@code AskdataAgent.ask(..., attributes)} 传到 Agent 内部,最终通过
 * {@code @V("index_context")} 注入到 SQL 生成的 Jinja 模板。
 *
 * <p>{@link #enabled} 为 false 时(项目未开启 index-ask 或 指标召回为空),
 * Jinja 模板会跳过整段 INDEX QUERY CONSTRAINTS,流程退化为通用问数。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor
public class IndexContext {

    public enum OrgResolutionMode {
        DEFAULT_SCOPE,
        SINGLE,
        MULTI_AGGREGATION,
        RANKING_LEVEL
    }

    public enum OrgAggregationMode {
        NONE,              // 不聚合（单机构查询）
        SUM_CHILDREN,      // 求和（多机构聚合）
        GROUP_BY_ORG,      // 分组对比（多机构并列）
        SUBTRACT,          // 求差（A - B）
        DIVIDE,            // 求比（A / B）
        UNCERTAIN,         // 意图不明确 — 跳过规则模板，交给大模型推理
        CUSTOM_EXPRESSION  // 自定义表达式（复杂计算）
    }

    /**
     * 计算表达式（用于复杂的多机构计算）
     */
    @Getter
    @Builder
    @AllArgsConstructor
    public static class CalcExpression {
        /** 运算符: SUM, SUBTRACT, DIVIDE, MULTIPLY */
        private final String operator;

        /** 左操作数机构列表 */
        private final List<String> leftOrgCodes;

        /** 右操作数机构列表（求差/求比时使用） */
        private final List<String> rightOrgCodes;

        /** 嵌套表达式（支持复杂计算） */
        private final CalcExpression leftExpr;
        private final CalcExpression rightExpr;

        /** 是否为叶子节点（单机构或机构组） */
        public boolean isLeaf() {
            return leftExpr == null && rightExpr == null;
        }
    }

    @Getter
    @Builder
    @AllArgsConstructor
    public static class OrgCandidate {
        private final String orgCode;
        private final String orgName;
        private final String pathOrgCodes;
        private final String matchedText;
        /**
         * 是否管理行。按 orgCode 字母前缀判断：FR* / A* 等带字母前缀 = 管理行（KPI 预聚合数据），
         * 纯数字 = 普通支行（仅自身数据）。
         */
        @Builder.Default
        private final boolean managementOrg = false;
    }

    /** 当前登录用户的 orgCode，用于解析"我行"、"本行"等机构代称。 */
    private final String userOrgCode;

    /** 是否启用 INDEX QUERY CONSTRAINTS 注入。false 时其他字段语义无效。 */
    private final boolean enabled;

    /**
     * 项目 ID。用于 Agent 在 selected 之后回填 similar_indices 时按项目隔离向量召回。
     * Resolver 已知,带过来给 Agent 用,避免 Agent 再去解析 attributes。
     */
    private final String projectId;

    /** 召回的候选指标(当前实现为项目全量指标库)。 */
    @Builder.Default
    private final List<IndexEntry> indexCandidates = Collections.emptyList();

    /**
     * 面向问题重写器的指标骨架摘要。
     * <p>不是 860 条明细平铺，而是按 family/source/note/alias 聚合后的项目级参考，
     * 让模型学习“当前项目有哪些指标家族、支持哪些口径和备注”。
     */
    @Builder.Default
    private final List<String> indexReferenceSummaries = Collections.emptyList();

    /**
     * 多口径分组(size>=2 才会构成分组)。当 size>0 时,问数完成后会触发
     * SIMILAR_QUESTION 事件,前端展示"您可能想问 XX 口径"。
     */
    @Builder.Default
    private final List<IndexCaliberGroup> caliberGroups = Collections.emptyList();

    /**
     * 当前用户全部可访问的 org_code 集合(由 OrgPermissionProvider 解析)。
     * 用于上层做合法性兜底校验。
     */
    @Builder.Default
    private final Set<String> accessibleOrgCodes = Collections.emptySet();

    /**
     * 本次查询写入 SQL {@code org_code IN (...)} 的 org_code 列表。
     * <p>由 {@code dataScope} 决定:总行/部室=accessibleOrgCodes,分行=自己+下属支行,
     * 支行=只有自己。若项目未上传机构信息表,降级为 {@code [userOrgCode]}。
     */
    @Builder.Default
    private final List<String> queryOrgCodes = Collections.emptyList();

    /** 问题中显式命中的机构编码列表。 */
    @Builder.Default
    private final List<String> resolvedOrgCodes = Collections.emptyList();

    /** 问题中显式命中的机构名称列表。 */
    @Builder.Default
    private final List<String> resolvedOrgNames = Collections.emptyList();

    /** 机构候选，用于调试和模板注入。 */
    @Builder.Default
    private final List<OrgCandidate> mentionedOrgCandidates = Collections.emptyList();

    /** 机构解析模式。 */
    @Builder.Default
    private final OrgResolutionMode orgResolutionMode = OrgResolutionMode.DEFAULT_SCOPE;

    /** 机构聚合模式。 */
    @Builder.Default
    private final OrgAggregationMode orgAggregationMode = OrgAggregationMode.NONE;

    /** 计算表达式（用于复杂的多机构计算）。 */
    private final CalcExpression calcExpression;

    /** 日期场景,详见 {@link DateScenario}。 */
    @Builder.Default
    private final DateScenario dateScenario = DateScenario.NONE;

    /** EQ/IN 场景下的具体日期列表(yyyy-MM-dd)。 */
    @Builder.Default
    private final List<String> dateValues = Collections.emptyList();

    /** BETWEEN 场景的起始日期(yyyy-MM-dd HH:mm:ss)。 */
    private final String dateRangeStart;

    /** BETWEEN 场景的结束日期(yyyy-MM-dd HH:mm:ss)。 */
    private final String dateRangeEnd;

    /**
     * SELECT 字段白名单,由 {@link QueryKind} 决定:
     * STANDARD → 24 字段,RANKING → 8 字段。
     */
    @Builder.Default
    private final List<String> selectColumnsWhitelist = Collections.emptyList();

    /** 查询类型,决定字段白名单与 SQL 形态。 */
    @Builder.Default
    private final QueryKind queryKind = QueryKind.STANDARD;

    /**
     * 查询机构(RANKING)场景输出的机构层级标签。
     * <p>对齐 kpi.sql 的 {jglx} 占位，如：分行 / 支行。
     */
    private final String rankingOrgLevelLabel;

    /**
     * 币种编码(curr_code),默认 "CN"(折人民币)。
     * <p>由 {@code CurrencyDetector} 从用户问题中检测,未命中时兜底 CN。
     */
    @Builder.Default
    private final String currencyCode = "CN";

    /**
     * 币种中文名称,默认 "折人民币"。
     */
    @Builder.Default
    private final String currencyName = "折人民币";

    /**
     * 排名限制数量。
     * <p>由 LLM 意图分类提取,例如：
     * - "排名第一" → rankingLimit=1
     * - "前三名" → rankingLimit=3
     * - "前10" → rankingLimit=10
     * <p>null 表示未检测到排名意图。
     */
    private final Integer rankingLimit;

    /**
     * 排名顺序。
     * <p>- "DESC" = 降序（最高/最大/最多）,默认
     * <p>- "ASC" = 升序（最低/最小/最少）
     */
    @Builder.Default
    private final String rankingOrder = "DESC";

    /** 便捷工厂:返回一个 disabled 的空上下文,等价于"未开启 index-ask"。 */
    public static IndexContext disabled() {
        return IndexContext.builder().enabled(false).build();
    }
}
