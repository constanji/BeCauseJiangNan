package ai.dat.server.openapi.controller;

import ai.dat.project.datastore.document.OrgNodeDocument;
import ai.dat.project.datastore.repository.OrgNodeRepository;
import ai.dat.project.datastore.service.OrgDataPermissionService;
import ai.dat.server.openapi.service.OrgNodeExcelImportService;
import ai.dat.server.openapi.service.OrgNodeFromTableImportService;
import ai.dat.server.openapi.service.ProjectService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 机构管理接口。
 * <p>机构信息默认由数据源表 {@code c_par_brch_level} 驱动，同时支持前端手动维护单条节点。
 *
 * <h3>API</h3>
 * <ul>
 *   <li>POST /api/v1/org/nodes                       手动新增机构节点</li>
 *   <li>PUT /api/v1/org/nodes/{orgCode}              编辑机构节点</li>
 *   <li>DELETE /api/v1/org/nodes/{orgCode}          删除机构节点</li>
 *   <li>POST /api/v1/org/nodes/import-from-table    从数据源表导入机构信息</li>
 *   <li>POST /api/v1/org/nodes/import-excel         从 Excel 导入机构信息</li>
 *   <li>DELETE /api/v1/org/nodes/all                清空</li>
 *   <li>GET /api/v1/org/nodes/datatimes             可用快照列表</li>
 *   <li>GET /api/v1/org/nodes/active-data-dt        当前激活快照</li>
 *   <li>PUT /api/v1/org/nodes/activate-data-dt      切换快照</li>
 *   <li>PUT /api/v1/org/nodes/brch-lv               修改单节点数据权限级别</li>
 * </ul>
 *
 * @Author DAT Team
 * @Date 2026/6/7
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/org")
@RequiredArgsConstructor
@ConditionalOnBean(OrgNodeRepository.class)
@Tag(name = "机构", description = "机构信息（数据源表驱动 + 手动维护，数据权限唯一权威源）")
public class OrgManageController {

    private final OrgNodeRepository orgNodeRepo;
    private final OrgDataPermissionService permissionService;
    private final ProjectService projectService;
    private final OrgNodeFromTableImportService tableImportService;
    private final OrgNodeExcelImportService excelImportService;

    @DeleteMapping("/nodes/all")
    @Operation(summary = "清空项目下全部机构信息(危险操作)")
    public void removeAllNodes(@RequestParam("projectId") String projectId) {
        orgNodeRepo.deleteByProjectId(projectId);
        permissionService.invalidate(projectId);
    }

    @GetMapping("/nodes")
    @Operation(summary = "获取当前机构树（只读，供前端预览）")
    public List<Map<String, Object>> listNodes(@RequestParam("projectId") String projectId) {
        java.util.Collection<OrgNodeDocument> nodes = permissionService.unsafeListAllNodes(projectId);
        if (nodes.isEmpty()) return List.of();
        Map<String, Map<String, Object>> byCode = new java.util.LinkedHashMap<>();
        for (OrgNodeDocument n : nodes) {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("orgCode", n.getOrgCode());
            m.put("orgName", n.getOrgName());
            m.put("brchLv", n.getBrchLv());
            m.put("dataScope", n.getDataScope());
            m.put("parentOrgCode", n.getParentOrgCode());
            m.put("dataDt", n.getDataDt());
            m.put("level", n.getLevel());
            m.put("pathOrgCodes", n.getPathOrgCodes());
            m.put("managementOrg", n.isManagementOrg());
            byCode.put(n.getOrgCode(), m);
        }
        List<Map<String, Object>> roots = new ArrayList<>();
        for (Map<String, Object> m : byCode.values()) {
            String parent = (String) m.get("parentOrgCode");
            if (parent == null || parent.isEmpty() || !byCode.containsKey(parent)) {
                roots.add(m);
            } else {
                Map<String, Object> p = byCode.get(parent);
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> children = (List<Map<String, Object>>) p.computeIfAbsent("children", k -> new ArrayList<>());
                children.add(m);
            }
        }
        return roots;
    }

    // ─── 数据源表导入 ──────────────────────────────────────────────────────

    @GetMapping("/nodes/datatimes")
    @Operation(summary = "获取项目的可用机构数据快照日期列表")
    public List<String> listDataTimes(@RequestParam("projectId") String projectId) {
        return permissionService.listAvailableDataDts(projectId);
    }

    @GetMapping("/nodes/active-data-dt")
    @Operation(summary = "获取项目当前激活的 dataDt")
    public ResponseEntity<?> getActiveDataDt(@RequestParam("projectId") String projectId) {
        String activeDt = permissionService.getActiveDataDt(projectId);
        String latestDt = permissionService.resolveLatestDataDt(projectId);
        return ResponseEntity.ok(Map.of(
                "activeDataDt", activeDt != null ? activeDt : (latestDt != null ? latestDt : ""),
                "isManual", activeDt != null,
                "latestDataDt", latestDt != null ? latestDt : ""
        ));
    }

    @PutMapping("/nodes/activate-data-dt")
    @Operation(summary = "切换机构数据快照")
    public ResponseEntity<?> activateDataDt(@RequestParam("projectId") String projectId,
                                            @RequestParam(value = "dataDt", required = false) String dataDt) {
        if (dataDt == null || dataDt.isBlank()) {
            permissionService.setActiveDataDt(projectId, null);
            String latestDt = permissionService.resolveLatestDataDt(projectId);
            permissionService.invalidate(projectId);
            return ResponseEntity.ok(Map.of(
                    "activeDataDt", latestDt != null ? latestDt : "",
                    "isManual", false,
                    "message", "已恢复自动使用最新快照"
            ));
        }
        List<String> available = permissionService.listAvailableDataDts(projectId);
        if (!available.contains(dataDt.trim())) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "InvalidDataDt",
                    "message", "快照 " + dataDt + " 不存在。可用快照: " + available
            ));
        }
        permissionService.setActiveDataDt(projectId, dataDt.trim());
        permissionService.invalidate(projectId);
        return ResponseEntity.ok(Map.of(
                "activeDataDt", dataDt.trim(),
                "isManual", true,
                "message", "已切换到快照 " + dataDt
        ));
    }

    @PutMapping("/nodes/brch-lv")
    @Operation(summary = "修改单个机构的数据权限级别（brchLv）",
            description = "brchLv ∈ {1,2,3,4}: 1=全行(ALL) / 2=本级+下级 / 3=管理行本级+下级 / 4=仅本级。" +
                    "dataScope 由 brchLv 自动派生（2/3 → SELF_AND_DESCENDANTS）。修改立即生效，无需重启。")
    public ResponseEntity<?> updateBrchLv(@RequestParam("projectId") String projectId,
                                          @RequestParam("orgCode") String orgCode,
                                          @RequestParam("brchLv") Integer brchLv) {
        try {
            OrgNodeDocument saved = permissionService.updateBrchLv(projectId, orgCode, brchLv);
            return ResponseEntity.ok(Map.of(
                    "orgCode", saved.getOrgCode(),
                    "brchLv", saved.getBrchLv(),
                    "dataScope", saved.getDataScope()
            ));
        } catch (IllegalArgumentException e) {
            log.warn("updateBrchLv rejected: projectId={}, orgCode={}, brchLv={}, reason={}",
                    projectId, orgCode, brchLv, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "InvalidRequest",
                    "message", e.getMessage()));
        }
    }

    // ─── 手动单条机构维护 ─────────────────────────────────────────────────

    @PostMapping("/nodes")
    @Operation(summary = "手动新增机构节点",
            description = "在激活快照（未激活则取最新快照）下新增单条机构节点。无快照时会以当前日期创建首个手动快照。")
    public ResponseEntity<?> addNode(@RequestBody OrgNodeRequest request) {
        String projectId = request.getProjectId();
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "projectId is required"));
        }
        try {
            OrgNodeDocument node = OrgNodeDocument.builder()
                    .orgCode(request.getOrgCode())
                    .orgName(request.getOrgName())
                    .parentOrgCode(request.getParentOrgCode())
                    .brchLv(request.getBrchLv())
                    .build();
            OrgNodeDocument saved = permissionService.addOrgNode(projectId, node);
            return ResponseEntity.ok(toOrgNodeResponse(saved));
        } catch (IllegalArgumentException e) {
            log.warn("addOrgNode rejected: projectId={}, orgCode={}, reason={}",
                    projectId, request.getOrgCode(), e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "InvalidRequest", "message", e.getMessage()));
        } catch (Exception e) {
            log.error("addOrgNode failed: projectId={}, orgCode={}", projectId, request.getOrgCode(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "AddFailed", "message", e.getMessage()));
        }
    }

    @PutMapping("/nodes/{orgCode}")
    @Operation(summary = "编辑机构节点",
            description = "修改机构名称、父节点或数据权限级别。父节点变更时会重新计算该节点及其后代的路径/层级。")
    public ResponseEntity<?> updateNode(@PathVariable("orgCode") String orgCode,
                                        @RequestBody OrgNodeRequest request) {
        String projectId = request.getProjectId();
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "projectId is required"));
        }
        if (orgCode == null || orgCode.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "orgCode is required"));
        }
        try {
            OrgDataPermissionService.OrgNodeUpdateRequest update =
                    new OrgDataPermissionService.OrgNodeUpdateRequest(
                            request.getOrgName(), request.getParentOrgCode(), request.getBrchLv());
            OrgNodeDocument saved = permissionService.updateOrgNode(projectId, orgCode, update);
            return ResponseEntity.ok(toOrgNodeResponse(saved));
        } catch (IllegalArgumentException e) {
            log.warn("updateOrgNode rejected: projectId={}, orgCode={}, reason={}",
                    projectId, orgCode, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "InvalidRequest", "message", e.getMessage()));
        } catch (Exception e) {
            log.error("updateOrgNode failed: projectId={}, orgCode={}", projectId, orgCode, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "UpdateFailed", "message", e.getMessage()));
        }
    }

    @DeleteMapping("/nodes/{orgCode}")
    @Operation(summary = "删除机构节点",
            description = "删除指定机构节点。默认有子节点时拒绝删除；cascade=true 时级联删除子树。")
    public ResponseEntity<?> deleteNode(@PathVariable("orgCode") String orgCode,
                                        @RequestParam("projectId") String projectId,
                                        @RequestParam(value = "cascade", defaultValue = "false") boolean cascade) {
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "projectId is required"));
        }
        if (orgCode == null || orgCode.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "orgCode is required"));
        }
        try {
            permissionService.deleteOrgNode(projectId, orgCode, cascade);
            return ResponseEntity.ok(Map.of(
                    "orgCode", orgCode,
                    "cascade", cascade,
                    "message", "deleted"));
        } catch (IllegalArgumentException e) {
            log.warn("deleteOrgNode rejected: projectId={}, orgCode={}, reason={}",
                    projectId, orgCode, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "InvalidRequest", "message", e.getMessage()));
        } catch (Exception e) {
            log.error("deleteOrgNode failed: projectId={}, orgCode={}", projectId, orgCode, e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "DeleteFailed", "message", e.getMessage()));
        }
    }

    // ─── 数据源表导入 ──────────────────────────────────────────────────────

    @PostMapping("/nodes/import-from-table")
    @Operation(summary = "从数据源表导入机构信息",
            description = "选择项目中的数据源和表名，校验表结构（必填列: data_dt / brchno / brchna / brchup / brchlv），" +
                    "通过后取最新 data_dt 快照导入 org_nodes。已存在的同 dataDt 数据会被替换。")
    public ResponseEntity<?> importFromTable(@RequestBody ImportFromTableRequest request) {
        String projectId = request.getProjectId();
        String datasourceId = request.getDatasourceId();
        String tableName = request.getTableName();

        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "projectId is required"));
        }
        if (datasourceId == null || datasourceId.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "datasourceId is required"));
        }
        if (tableName == null || tableName.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "tableName is required"));
        }

        ai.dat.boot.ProjectRunner runner;
        try {
            runner = projectService.getProjectRunner(projectId, datasourceId);
        } catch (Exception e) {
            log.warn("Failed to get ProjectRunner for project={}, datasource={}: {}",
                    projectId, datasourceId, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "DataAccessFailed",
                    "message", "无法访问数据源: " + e.getMessage()));
        }

        OrgNodeFromTableImportService.ImportResult result;
        try {
            result = tableImportService.importFromTable(
                    runner.getDatabaseAdapter(), tableName, projectId);
        } catch (IllegalArgumentException e) {
            log.warn("Schema validation failed for table {}: {}", tableName, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "SchemaValidationFailed",
                    "message", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to import from table {}: {}", tableName, e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "ImportFailed",
                    "message", e.getMessage()));
        }

        int count = 0;
        if (!result.getNodes().isEmpty()) {
            String dt = result.getDataDt();
            if (dt != null) {
                orgNodeRepo.deleteByProjectIdAndDataDt(projectId, dt);
            }
            for (OrgNodeDocument n : result.getNodes()) {
                n.setProjectId(projectId);
            }
            orgNodeRepo.saveAll(result.getNodes());
            count = result.getNodes().size();
        }
        permissionService.invalidate(projectId);

        log.info("Imported {} org nodes from table {} (dataDt={}) for project {}",
                count, tableName, result.getDataDt(), projectId);
        return ResponseEntity.ok(ImportResultResponse.builder()
                .imported(count)
                .dataDt(result.getDataDt())
                .build());
    }

    @PostMapping("/nodes/import-excel")
    @Operation(summary = "从 Excel 导入机构信息",
            description = "上传 c_par_brch_level 导出的 .xlsx 文件。首行表头必须包含必填列: " +
                    "data_dt / brchno / brchna / brchup / brchlv。取最大 data_dt 快照导入，同 dataDt 数据会被替换。")
    public ResponseEntity<?> importFromExcel(@RequestParam("projectId") String projectId,
                                              @RequestParam("file") MultipartFile file) {
        if (projectId == null || projectId.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "MissingParam", "message", "projectId is required"));
        }

        OrgNodeFromTableImportService.ImportResult result;
        try {
            result = excelImportService.importFromExcel(file, projectId);
        } catch (IllegalArgumentException e) {
            log.warn("Excel validation failed: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "error", "SchemaValidationFailed",
                    "message", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to import from excel: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "ImportFailed",
                    "message", e.getMessage()));
        }

        int count = 0;
        if (!result.getNodes().isEmpty()) {
            String dt = result.getDataDt();
            if (dt != null) {
                orgNodeRepo.deleteByProjectIdAndDataDt(projectId, dt);
            }
            for (OrgNodeDocument n : result.getNodes()) {
                n.setProjectId(projectId);
            }
            orgNodeRepo.saveAll(result.getNodes());
            count = result.getNodes().size();
        }
        permissionService.invalidate(projectId);

        log.info("Imported {} org nodes from excel (dataDt={}) for project {}",
                count, result.getDataDt(), projectId);
        return ResponseEntity.ok(ImportResultResponse.builder()
                .imported(count)
                .dataDt(result.getDataDt())
                .build());
    }

    // ─── DTO ──────────────────────────────────────────────────────────────

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportFromTableRequest {
        private String projectId;
        private String datasourceId;
        private String tableName;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportResultResponse {
        private int imported;
        private String dataDt;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrgNodeRequest {
        private String projectId;
        private String orgCode;
        private String orgName;
        private String parentOrgCode;
        private Integer brchLv;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrgNodeResponse {
        private String id;
        private String orgCode;
        private String orgName;
        private String parentOrgCode;
        private Integer brchLv;
        private String dataScope;
        private String dataDt;
        private Integer level;
        private String pathOrgCodes;
        private boolean managementOrg;
    }

    private OrgNodeResponse toOrgNodeResponse(OrgNodeDocument node) {
        return OrgNodeResponse.builder()
                .id(node.getId())
                .orgCode(node.getOrgCode())
                .orgName(node.getOrgName())
                .parentOrgCode(node.getParentOrgCode())
                .brchLv(node.getBrchLv())
                .dataScope(node.getDataScope())
                .dataDt(node.getDataDt())
                .level(node.getLevel())
                .pathOrgCodes(node.getPathOrgCodes())
                .managementOrg(node.isManagementOrg())
                .build();
    }
}
