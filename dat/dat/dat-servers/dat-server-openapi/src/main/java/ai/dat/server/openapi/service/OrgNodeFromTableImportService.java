package ai.dat.server.openapi.service;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.contentstore.data.LightSchema;
import ai.dat.project.datastore.document.OrgNodeDocument;
import ai.dat.project.datastore.service.OrgDataPermissionService;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * 从数据源表导入机构信息。
 *
 * <h3>支持的源表</h3>
 * 目标表 {@code c_par_brch_level}（机构衍生表）。必填列:
 * {@code data_dt, brchno, brchna, brchup, brchlv}。
 *
 * <h3>映射规则</h3>
 * <ul>
 *   <li>{@code brchno} → orgCode</li>
 *   <li>{@code brchna} → orgName</li>
 *   <li>{@code brchup} → parentOrgCode（"00000" 视为 null）</li>
 *   <li>{@code brchlv} → brchLv（Integer；非数字容错为 null）</li>
 *   <li>{@code data_dt} → dataDt（仅取最新 dataDt 的行）</li>
 *   <li>dataScope: 按 brchLv 派生（1→ALL, 2/3→SELF_AND_DESCENDANTS, 4→SELF）；
 *       brchLv 为空时回退按 isManagementOrg + hasChildren 推断</li>
 * </ul>
 * <p>是否管理行由 {@code OrgNodeDocument#isManagementOrg()} 按 orgCode 字母前缀决定。
 *
 * @Author DAT Team
 * @Date 2026/6/26
 */
@Slf4j
@Service
public class OrgNodeFromTableImportService {

    /** 必填列名（全部来自 c_par_brch_level 表）。 */
    static final Set<String> REQUIRED_COLUMNS = Set.of(
            "data_dt", "brchno", "brchna", "brchup", "brchlv");

    /** 哨兵值：表示"银行之上"的虚拟根，应映射为 null parent。 */
    private static final String SENTINEL_PARENT = "00000";

    /** 匹配 dataDt 开头的 yyyy-MM-dd 部分，用于归一化快照键。 */
    private static final java.util.regex.Pattern DATA_DT_PATTERN =
            java.util.regex.Pattern.compile("(\\d{4}-\\d{2}-\\d{2})");

    /**
     * 把 dataDt 归一化为 {@code yyyy-MM-dd} 作为快照去重键。
     * <p>Excel 日期单元格会被格式化为 "2026-07-10 00:00:00"，数据源 {@code MAX(data_dt)}
     * 可能返回 "2026-07-10" 或带毫秒的时间戳。若不归一化，同一天会被当成两个快照，
     * 导致跨来源(Excel↔数据源)重复导入时同一 orgCode 落到两份快照里、无法互相替换。
     * 归一化后两边对同一天产生相同快照键，{@code deleteByProjectIdAndDataDt} 才能正确替换，
     * 实现"按 data_dt + 编码去重、增量导入不重复"。
     * <p>无法识别的格式原样 trim 返回(不丢信息)。
     */
    static String normalizeDataDt(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return s;
        java.util.regex.Matcher m = DATA_DT_PATTERN.matcher(s);
        return m.lookingAt() ? m.group(1) : s;
    }

    /**
     * 从数据源表导入机构信息。
     * <p>为避免线上 200w+ 历史行全量加载导致 OOM，采用"先取最大 data_dt，再只加载该快照"
     * 的策略；同一快照内若出现重复 orgCode，按编码去重保留一条。
     *
     * @param adapter    数据源适配器
     * @param tableName  源表名（如 {@code c_par_brch_level}）
     * @param projectId  项目 ID
     * @return 导入结果（含映射后的机构节点列表和使用的 dataDt）
     * @throws IllegalArgumentException 表结构校验不通过
     * @throws RuntimeException 读取表数据失败
     */
    public ImportResult importFromTable(DatabaseAdapter adapter, String tableName, String projectId) {
        // 1) 校验表结构
        List<LightSchema.ColumnInfo> columns;
        try {
            columns = adapter.getColumns(tableName);
        } catch (Exception e) {
            throw new IllegalArgumentException("无法读取表 " + tableName + " 的列信息: " + e.getMessage());
        }
        Set<String> colNames = new HashSet<>();
        for (LightSchema.ColumnInfo c : columns) {
            colNames.add(c.getName().toLowerCase());
        }
        List<String> missing = new ArrayList<>();
        for (String req : REQUIRED_COLUMNS) {
            if (!colNames.contains(req.toLowerCase())) {
                missing.add(req);
            }
        }
        if (!missing.isEmpty()) {
            throw new IllegalArgumentException(
                    "表 " + tableName + " 结构不符合 c_par_brch_level 规范，缺少必填列: " + missing);
        }

        // 2) 先取最新 data_dt（避免全表扫描加载到内存）
        String latestDataDt;
        try {
            List<Map<String, Object>> dtRows = adapter.executeQuery(
                    "SELECT MAX(data_dt) AS max_dt FROM " + tableName);
            if (dtRows == null || dtRows.isEmpty()) {
                return ImportResult.builder().nodes(Collections.emptyList()).dataDt(null).build();
            }
            Object maxDtValue = dtRows.get(0).get("max_dt");
            latestDataDt = maxDtValue != null ? maxDtValue.toString() : null;
        } catch (Exception e) {
            throw new RuntimeException("读取最新 data_dt 失败: " + e.getMessage());
        }
        if (latestDataDt == null || latestDataDt.isBlank()) {
            return ImportResult.builder().nodes(Collections.emptyList()).dataDt(null).build();
        }

        // 3) 只加载最新快照行
        List<Map<String, Object>> rows;
        try {
            rows = adapter.executeQuery("SELECT * FROM " + tableName + " WHERE data_dt = '" + latestDataDt + "'");
        } catch (Exception e) {
            throw new RuntimeException("读取表数据失败: " + e.getMessage());
        }
        if (rows.isEmpty()) {
            return ImportResult.builder().nodes(Collections.emptyList()).dataDt(null).build();
        }

        // dataDt 归一化为 yyyy-MM-dd 作为快照键：保证 Excel 与数据源对同一天产生相同键，
        // 跨来源重复导入时 deleteByProjectIdAndDataDt 能正确替换、按 (dataDt, orgCode) 去重
        return buildNodesFromRows(rows, projectId, normalizeDataDt(latestDataDt), tableName);
    }

    /**
     * 将原始行列表转换为机构节点列表，并执行去重、dataScope 派生等后处理。
     * <p>供表导入和 Excel 导入共用。
     *
     * @param rows      原始行（每行 key 为小写列名，含 brchno/brchna/brchup/brchlv/data_dt）
     * @param projectId 项目 ID
     * @param dataDt    该批次统一使用的 dataDt
     * @param sourceTag 日志来源标识（表名或 "excel"）
     * @return 导入结果
     */
    public static ImportResult buildNodesFromRows(List<Map<String, Object>> rows, String projectId,
                                                   String dataDt, String sourceTag) {
        // 4) 逐行映射并按 orgCode 去重（同一快照理论上不应重复，防御性处理）
        Map<String, OrgNodeDocument> nodeMap = new java.util.LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            OrgNodeDocument doc = mapRow(row, projectId, dataDt);
            if (doc == null) {
                continue;
            }
            String code = doc.getOrgCode();
            OrgNodeDocument existing = nodeMap.put(code, doc);
            if (existing != null) {
                log.warn("机构导入源 [{}] 中存在重复 orgCode [{}]，保留后出现的行", sourceTag, code);
            }
        }
        List<OrgNodeDocument> nodes = new ArrayList<>(nodeMap.values());

        // 5) 后处理：dataScope 按 brchLv 派生；brchLv 为空回退旧规则（isManagementOrg + hasChildren）
        Set<String> parentCodes = new HashSet<>();
        for (OrgNodeDocument n : nodes) {
            if (n.getParentOrgCode() != null) parentCodes.add(n.getParentOrgCode());
        }
        for (OrgNodeDocument n : nodes) {
            if (n.getDataScope() == null || n.getDataScope().isEmpty()) {
                boolean hasChildren = parentCodes.contains(n.getOrgCode());
                n.setDataScope(OrgDataPermissionService.deriveDataScope(
                        n.getBrchLv(), n.isManagementOrg(), hasChildren));
            }
        }

        return ImportResult.builder().nodes(nodes).dataDt(dataDt).build();
    }

    // ─── 行映射 ────────────────────────────────────────────────────────────

    static OrgNodeDocument mapRow(Map<String, Object> row, String projectId, String dataDt) {
        String orgCode = str(row, "brchno");
        if (orgCode == null || orgCode.isBlank()) {
            log.warn("跳过 brchno 为空的行");
            return null;
        }
        String orgName = str(row, "brchna");
        String parentCode = str(row, "brchup");
        if (SENTINEL_PARENT.equals(parentCode)) {
            parentCode = null;
        }
        Integer brchLv = parseBrchLv(str(row, "brchlv"));

        return OrgNodeDocument.builder()
                .projectId(projectId)
                .orgCode(orgCode.trim())
                .orgName(orgName != null ? orgName.trim() : orgCode.trim())
                .brchLv(brchLv)
                .dataScope(null)   // 后处理阶段统一派生
                .parentOrgCode(parentCode)
                .dataDt(dataDt)
                .build();
    }

    // ─── 辅助方法 ───────────────────────────────────────────────────────────

    static Integer parseBrchLv(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return Integer.valueOf(raw.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static String str(Map<String, Object> row, String key) {
        Object v = row.get(key);
        return v != null ? v.toString() : null;
    }

    // ─── 返回类型 ───────────────────────────────────────────────────────────

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportResult {
        private List<OrgNodeDocument> nodes;
        private String dataDt;
    }
}
