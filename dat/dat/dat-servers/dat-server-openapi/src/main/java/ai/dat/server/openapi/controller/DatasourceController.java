package ai.dat.server.openapi.controller;

import ai.dat.boot.ProjectRunner;
import ai.dat.core.contentstore.data.KpiInfoRow;
import ai.dat.core.contentstore.data.LightSchema;
import ai.dat.project.datasource.document.DatasourceDocument;
import ai.dat.project.datasource.service.DatasourceService;
import ai.dat.server.openapi.service.ProjectService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据源管理 API
 * 仅在 MongoDB 模式下可用
 *
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/datasources")
@Tag(name = "数据源管理", description = "数据源的增删改查接口")
@ConditionalOnProperty(prefix = "dat.server", name = "mode", havingValue = "mongodb")
public class DatasourceController {

    private final DatasourceService datasourceService;
    private final ProjectService projectService;

    @Autowired
    public DatasourceController(@Qualifier("datastoreDatasourceService") DatasourceService datasourceService,
                                 ProjectService projectService) {
        this.datasourceService = datasourceService;
        this.projectService = projectService;
    }

    @GetMapping
    @Operation(summary = "获取数据源列表")
    public ResponseEntity<List<DatasourceDocument>> list(
            @RequestParam(value = "projectId", required = false) String projectId) {
        List<DatasourceDocument> datasources;
        if (projectId != null && !projectId.isEmpty()) {
            datasources = datasourceService.listByProjectId(projectId);
        } else {
            datasources = datasourceService.listAll();
        }
        return ResponseEntity.ok(datasources);
    }

    @GetMapping("/{id}")
    @Operation(summary = "获取数据源详情")
    public ResponseEntity<DatasourceDocument> getById(@PathVariable("id") String id) {
        DatasourceDocument datasource = datasourceService.getById(id);
        return ResponseEntity.ok(datasource);
    }

    @PostMapping
    @Operation(summary = "创建数据源")
    public ResponseEntity<DatasourceDocument> create(@RequestBody CreateDatasourceRequest request) {
        DatasourceDocument created = datasourceService.create(
                request.getProjectId(),
                request.getName(),
                request.getDescription(),
                request.getProvider(),
                request.getConnectionConfig()
        );
        return ResponseEntity.ok(created);
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新数据源")
    public ResponseEntity<DatasourceDocument> update(@PathVariable("id") String id, 
                                                      @RequestBody DatasourceDocument datasource) {
        datasource.setId(id);
        DatasourceDocument updated = datasourceService.update(
                id, 
                datasource.getName(),
                datasource.getDescription(),
                datasource.getProvider(),
                datasource.getConfiguration()
        );
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除数据源")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable("id") String id) {
        datasourceService.delete(id);
        return ResponseEntity.ok(Map.of("success", true, "message", "Datasource deleted successfully"));
    }

    /**
     * 创建数据源请求
     */
    @Data
    public static class CreateDatasourceRequest {
        private String projectId;
        private String name;
        private String description;
        private String provider;
        private Map<String, Object> connectionConfig;
    }

    // ─── 表浏览（供指标库数据源导入使用）────────────────────────────────

    @GetMapping("/{id}/schemas")
    @Operation(summary = "列出数据源中的所有 schema")
    public ResponseEntity<List<String>> listSchemas(@PathVariable("id") String datasourceId) {
        try {
            ProjectRunner runner = projectService.getProjectRunner(
                    datasourceService.getById(datasourceId).getProjectId(), datasourceId);
            List<String> schemas = runner.getDatabaseAdapter().getSchemas();
            return ResponseEntity.ok(schemas);
        } catch (Exception e) {
            log.warn("Failed to list schemas for datasource {}: {}", datasourceId, e.getMessage());
            return ResponseEntity.ok(List.of());
        }
    }

    @GetMapping("/{id}/schemas/{schema}/tables")
    @Operation(summary = "列出指定 schema 下的表名")
    public ResponseEntity<List<String>> listTablesBySchema(
            @PathVariable("id") String datasourceId,
            @PathVariable("schema") String schema) {
        try {
            ProjectRunner runner = projectService.getProjectRunner(
                    datasourceService.getById(datasourceId).getProjectId(), datasourceId);
            List<String> tables = runner.getDatabaseAdapter().getTableNames(schema);
            return ResponseEntity.ok(tables);
        } catch (Exception e) {
            log.warn("Failed to list tables for datasource {} schema {}: {}", datasourceId, schema, e.getMessage());
            return ResponseEntity.ok(List.of());
        }
    }

    @GetMapping("/{id}/tables")
    @Operation(summary = "列出数据源中的全部表名（向后兼容）")
    public ResponseEntity<List<String>> listTables(@PathVariable("id") String datasourceId) {
        try {
            ProjectRunner runner = projectService.getProjectRunner(
                    datasourceService.getById(datasourceId).getProjectId(), datasourceId);
            List<String> tables = runner.getDatabaseAdapter().getTableNames();
            return ResponseEntity.ok(tables);
        } catch (Exception e) {
            log.warn("Failed to list tables for datasource {}: {}", datasourceId, e.getMessage());
            return ResponseEntity.ok(List.of());
        }
    }

    @GetMapping("/{id}/tables/{tableName:.+}/columns")
    @Operation(summary = "获取指定表的列信息（用于 kpi_info schema 校验）")
    public ResponseEntity<Map<String, Object>> getTableColumns(
            @PathVariable("id") String datasourceId,
            @PathVariable("tableName") String tableName) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            ProjectRunner runner = projectService.getProjectRunner(
                    datasourceService.getById(datasourceId).getProjectId(), datasourceId);
            List<LightSchema.ColumnInfo> columns = runner.getDatabaseAdapter().getColumns(tableName);
            List<Map<String, String>> cols = new java.util.ArrayList<>();
            for (LightSchema.ColumnInfo c : columns) {
                Map<String, String> m = new LinkedHashMap<>();
                m.put("name", c.getName());
                m.put("type", c.getType());
                cols.add(m);
            }
            result.put("tableName", tableName);
            result.put("columns", cols);
            boolean valid = validateKpiInfoSchema(columns);
            result.put("valid", valid);
            if (!valid) {
                result.put("message", KpiInfoRow.missingColumnsMessage());
            }
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.warn("Failed to get columns for {}.{}: {}", datasourceId, tableName, e.getMessage());
            result.put("error", e.getMessage());
            return ResponseEntity.ok(result);
        }
    }

    private boolean validateKpiInfoSchema(List<LightSchema.ColumnInfo> columns) {
        List<String> columnNames = columns.stream()
                .map(LightSchema.ColumnInfo::getName)
                .toList();
        return KpiInfoRow.hasRequiredColumns(columnNames);
    }
}
