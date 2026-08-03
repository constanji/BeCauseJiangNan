package ai.dat.core.index.provider;

import ai.dat.core.index.data.IndexContext;

import java.util.List;
import java.util.Set;

/**
 * 机构数据权限的抽象。
 * <p>由 {@code IndexContextResolver} 调用,把"用户身份(orgCode)"翻译成本次问数
 * 在 SQL 里要用的 {@code org_code IN (...)} 集合。
 *
 * <p>实现位于 dat-datastore 层,与 {@code OrgDataPermissionService} 复用。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
public interface OrgPermissionProvider {

    /** 用户可访问的全部 org_code 集合;用户不存在/项目无树 → 空集。仅用于越权校验,不直接进 SQL。 */
    Set<String> resolveAccessibleOrgCodes(String projectId, String userOrgCode);

    /**
     * 本次问数默认写入 SQL {@code org_code IN (...)} 的 org_code 列表。
     * <p>规则:数据仓库已按机构层级预聚合(管理行 KPI 数据为该机构汇总),
     * 所以**默认只查用户自己的 org_code**,而不是 IN 整棵子树。
     * <p>排名/对比类查询(QueryKind=RANKING)由 IndexContextResolver 单独扩展到下属集合。
     */
    List<String> defaultQueryOrgCodes(String projectId, String userOrgCode);

    /** 返回当前用户权限范围内全部机构候选，用于机构名解析。 */
    List<IndexContext.OrgCandidate> listAccessibleOrgNodes(String projectId, String userOrgCode);
}
