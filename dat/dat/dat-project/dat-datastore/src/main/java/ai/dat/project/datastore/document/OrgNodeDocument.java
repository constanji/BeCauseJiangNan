package ai.dat.project.datastore.document;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * 机构信息节点。
 * <p>
 * 仅由数据源表 {@code c_par_brch_level} 通过 {@code OrgNodeFromTableImportService}
 * 导入；不再支持 JSON 上传。
 *
 * <h3>字段语义</h3>
 * <ul>
 *   <li>{@code orgCode}      机构编码。字母前缀(FR001/A8000/A*) = 管理行；纯数字 = 普通支行</li>
 *   <li>{@code orgName}      机构名称</li>
 *   <li>{@code parentOrgCode} 父机构 orgCode；根节点(总行)为空</li>
 *   <li>{@code brchLv}       机构级别（1/2/3/4，来自 c_par_brch_level.brchlv）——
 *       数据权限的权威源，UI 展示 4 级；{@code dataScope} 由它派生。可空以兼容旧数据。
 *       <ul>
 *         <li>1 = 法人行 / 全行           → dataScope=ALL</li>
 *         <li>2 = 分行 / 总行部室          → dataScope=SELF_AND_DESCENDANTS</li>
 *         <li>3 = 一级支行 / 管理支行 / 职能部门 → dataScope=SELF_AND_DESCENDANTS</li>
 *         <li>4 = 二级支行 / 网点          → dataScope=SELF</li>
 *       </ul></li>
 *   <li>{@code dataScope}    ALL / SELF_AND_DESCENDANTS / SELF
 *       — 决定该机构用户能查询的 org_code 范围；由 {@code brchLv} 派生，
 *       {@code brchLv} 为空时回退按 isManagementOrg + hasChildren 推断</li>
 *   <li>{@code dataDt}       数据日期快照，来自 c_par_brch_level.data_dt</li>
 *   <li>{@code pathOrgCodes} 由系统启动期 ensureLoaded 时计算，无需上传方维护</li>
 *   <li>{@code level}        树深度层级（沿 parentOrgCode 计算，0=根）；与 brchLv 不同——
 *       brchLv 是业务级别，level 是树深度</li>
 * </ul>
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "org_nodes")
@CompoundIndex(name = "proj_dt_code",
        def = "{'projectId': 1, 'dataDt': 1, 'orgCode': 1}", unique = true)
public class OrgNodeDocument {

    @Id
    private String id;

    /** 所属项目 ID。 */
    private String projectId;

    private String orgCode;

    private String orgName;

    /** ALL / SELF_AND_DESCENDANTS / SELF；由 brchLv 派生，brchLv 为空时回退旧规则 */
    private String dataScope;

    /**
     * 机构级别 1/2/3/4（源自 c_par_brch_level.brchlv）。数据权限的权威源。
     * <p>可空——旧数据 / 手工上传兼容；空时 dataScope 回退到 isManagementOrg+hasChildren 推断。
     */
    private Integer brchLv;

    /** 父机构 orgCode；根节点为空 */
    private String parentOrgCode;

    /** 数据日期快照，例如 "2025-02-28"；来自 c_par_brch_level.data_dt。 */
    private String dataDt;

    /** 路径表达式，例如 "FR001/A0001/A0008"；启动期重算，业务方不需要填 */
    private String pathOrgCodes;

    /** 树深度层级（沿 parentOrgCode 计算，0=根），启动期重算。**与 brchLv 不同**——brchLv 是业务级别。 */
    private Integer level;

    /**
     * 是否管理行。
     * <p>线上银行机构编码约定：
     * <ul>
     *   <li>{@code FR001} = 总行（管理行）</li>
     *   <li>{@code A8000} = 总行部室（管理行）</li>
     *   <li>{@code A*} = 分行 / 管理支行（管理行，如 A0008 金坛支行管理行）</li>
     *   <li>纯数字（如 {@code 01201}）= 普通支行（非管理行，仅代表自身数据）</li>
     * </ul>
     * <p>管理行的 KPI 数据已经预聚合，查询取一条记录即为汇总值；
     * 普通支行的数据只代表自身。
     */
    public boolean isManagementOrg() {
        if (orgCode == null || orgCode.isEmpty()) return false;
        return Character.isLetter(orgCode.charAt(0));
    }
}
