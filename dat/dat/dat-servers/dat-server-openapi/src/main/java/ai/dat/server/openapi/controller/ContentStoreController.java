package ai.dat.server.openapi.controller;

import ai.dat.boot.ProjectRunner;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.*;
import ai.dat.server.openapi.service.CellVectorizationService;
import ai.dat.server.openapi.service.DocumentParseService;
import ai.dat.server.openapi.service.LightSchemaGenerator;
import ai.dat.server.openapi.service.ProjectService;
import lombok.Data;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 内容存储管理控制器
 * 提供 SQL 示例对、同义词、业务知识的 CRUD 接口
 *
 * @Author DAT Team
 * @Date 2025/12/24
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/content-store")
@CrossOrigin
public class ContentStoreController {

    private final ProjectService projectService;
    private final DocumentParseService documentParseService;
    private final LightSchemaGenerator lightSchemaGenerator;
    private final CellVectorizationService cellVectorizationService;
    private final ai.dat.project.datastore.service.LightSchemaPersistenceService lightSchemaPersistenceService;
    private final ai.dat.project.datastore.service.CellTablePersistenceService cellTablePersistenceService;
    private final ai.dat.server.openapi.service.LightSchemaEnricher lightSchemaEnricher;

    @Autowired
    public ContentStoreController(ProjectService projectService,
                                  DocumentParseService documentParseService,
                                  LightSchemaGenerator lightSchemaGenerator,
                                  CellVectorizationService cellVectorizationService,
                                  @Autowired(required = false) ai.dat.project.datastore.service.LightSchemaPersistenceService lightSchemaPersistenceService,
                                  @Autowired(required = false) ai.dat.project.datastore.service.CellTablePersistenceService cellTablePersistenceService,
                                  ai.dat.server.openapi.service.LightSchemaEnricher lightSchemaEnricher) {
        this.projectService = projectService;
        this.documentParseService = documentParseService;
        this.lightSchemaGenerator = lightSchemaGenerator;
        this.cellVectorizationService = cellVectorizationService;
        this.lightSchemaPersistenceService = lightSchemaPersistenceService;
        this.cellTablePersistenceService = cellTablePersistenceService;
        this.lightSchemaEnricher = lightSchemaEnricher;
    }



    // ============ SQL Pairs ============

    /**
     * 获取所有 SQL 示例对
     */
    @GetMapping("/sql-pairs")
    public List<QuestionSqlPairWithId> listSqlPairs(@RequestParam("projectId") String projectId) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.allSqlsWithId();
    }

    /**
     * 检索相关的 SQL 示例对
     */
    @GetMapping("/sql-pairs/retrieve")
    public List<QuestionSqlPair> retrieveSqlPairs(@RequestParam("projectId") String projectId,
                                                   @RequestParam("query") String query) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.retrieveSql(query);
    }

    /**
     * 添加 SQL 示例对
     */
    @PostMapping("/sql-pairs")
    public String addSqlPair(@RequestParam("projectId") String projectId,
                             @RequestBody QuestionSqlPair sqlPair) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.addSql(sqlPair);
    }

    /**
     * 批量添加 SQL 示例对
     */
    @PostMapping("/sql-pairs/batch")
    public List<String> addSqlPairs(@RequestParam("projectId") String projectId,
                                     @RequestBody List<QuestionSqlPair> sqlPairs) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.addSqls(sqlPairs);
    }

    /**
     * 删除 SQL 示例对
     */
    @DeleteMapping("/sql-pairs/{id}")
    public void removeSqlPair(@RequestParam("projectId") String projectId,
                              @PathVariable("id") String id) {
        ContentStore contentStore = getContentStore(projectId);
        contentStore.removeSql(id);
    }

    /**
     * 清空所有 SQL 示例对
     */
    @DeleteMapping("/sql-pairs")
    public void removeAllSqlPairs(@RequestParam("projectId") String projectId) {
        ContentStore contentStore = getContentStore(projectId);
        contentStore.removeAllSqls();
    }

    // ============ Synonyms ============

    /**
     * 获取所有同义词对
     */
    @GetMapping("/synonyms")
    public List<WordSynonymPairWithId> listSynonyms(@RequestParam("projectId") String projectId) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.allSynsWithId();
    }

    /**
     * 检索相关的同义词对
     */
    @GetMapping("/synonyms/retrieve")
    public List<WordSynonymPair> retrieveSynonyms(@RequestParam("projectId") String projectId,
                                                   @RequestParam("query") String query) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.retrieveSyn(query);
    }

    /**
     * 添加同义词对
     */
    @PostMapping("/synonyms")
    public String addSynonym(@RequestParam("projectId") String projectId,
                             @RequestBody WordSynonymPair synonym) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.addSyn(synonym);
    }

    /**
     * 批量添加同义词对
     */
    @PostMapping("/synonyms/batch")
    public List<String> addSynonyms(@RequestParam("projectId") String projectId,
                                     @RequestBody List<WordSynonymPair> synonyms) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.addSyns(synonyms);
    }

    /**
     * 删除同义词对
     */
    @DeleteMapping("/synonyms/{id}")
    public void removeSynonym(@RequestParam("projectId") String projectId,
                              @PathVariable("id") String id) {
        ContentStore contentStore = getContentStore(projectId);
        contentStore.removeSyn(id);
    }

    /**
     * 清空所有同义词对
     */
    @DeleteMapping("/synonyms")
    public void removeAllSynonyms(@RequestParam("projectId") String projectId) {
        ContentStore contentStore = getContentStore(projectId);
        contentStore.removeAllSyns();
    }

    // ============ Docs ============

    /**
     * 获取所有业务知识文档
     */
    @GetMapping("/docs")
    public List<DocWithId> listDocs(@RequestParam("projectId") String projectId) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.allDocsWithId();
    }

    /**
     * 检索相关的业务知识文档
     */
    @GetMapping("/docs/retrieve")
    public List<String> retrieveDocs(@RequestParam("projectId") String projectId,
                                      @RequestParam("query") String query) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.retrieveDoc(query);
    }

    /**
     * 添加业务知识文档
     */
    @PostMapping("/docs")
    public String addDoc(@RequestParam("projectId") String projectId,
                         @RequestBody DocRequest request) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.addDoc(request.getContent());
    }

    /**
     * 批量添加业务知识文档
     */
    @PostMapping("/docs/batch")
    public List<String> addDocs(@RequestParam("projectId") String projectId,
                                 @RequestBody List<String> docs) {
        ContentStore contentStore = getContentStore(projectId);
        return contentStore.addDocs(docs);
    }

    /**
     * 删除业务知识文档
     */
    @DeleteMapping("/docs/{id}")
    public void removeDoc(@RequestParam("projectId") String projectId,
                          @PathVariable("id") String id) {
        ContentStore contentStore = getContentStore(projectId);
        contentStore.removeDoc(id);
    }

    /**
     * 清空所有业务知识文档
     */
    @DeleteMapping("/docs")
    public void removeAllDocs(@RequestParam("projectId") String projectId) {
        ContentStore contentStore = getContentStore(projectId);
        contentStore.removeAllDocs();
    }

    /**
     * 上传文件并解析为业务知识文档
     * 支持 TXT, MD, PDF, DOC, DOCX 等格式
     */
    @PostMapping("/docs/upload")
    public UploadResult uploadDoc(@RequestParam("projectId") String projectId,
                                   @RequestParam("file") org.springframework.web.multipart.MultipartFile file) {
        try {
            String filename = file.getOriginalFilename();
            if (!documentParseService.isSupported(filename)) {
                throw new IllegalArgumentException("不支持的文件格式: " + filename);
            }
            
            String content = documentParseService.parseFile(file);
            ContentStore contentStore = getContentStore(projectId);
            String docId = contentStore.addDoc(content);
            
            log.info("Successfully uploaded and parsed document: {} -> docId: {}", filename, docId);
            return new UploadResult(docId, filename, content.length());
        } catch (Exception e) {
            log.error("Failed to upload document", e);
            throw new RuntimeException("文件上传失败: " + e.getMessage(), e);
        }
    }

    /**
     * 获取支持的文件格式列表
     */
    // ============ Preprocessing (Light Schema & Cells) ============

    /**
     * 生成并保存 Light Schema。
     * 支持按表生成（增量）：若 request.tableNames 非空，则只对指定表执行生成 + 替换；
     * 其他表的 schema 保持不变。tableNames 为空时对该数据源所有表执行全量重建。
     */
    @PostMapping("/light-schema/generate")
    public String generateLightSchema(@RequestParam("projectId") String projectId,
                                      @RequestParam("datasourceId") String datasourceId,
                                      @RequestParam(value = "sampleLimit", defaultValue = "5") int sampleLimit,
                                      @RequestParam(value = "enrich", defaultValue = "true") boolean enrich,
                                      @RequestBody(required = false) GenerateLightSchemaRequest request) {
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }

        List<String> selectedTables = request == null ? null : request.getTableNames();
        boolean incremental = selectedTables != null && !selectedTables.isEmpty();

        List<LightSchema> schemas = lightSchemaGenerator.generate(
                runner.getDatabaseAdapter(), sampleLimit, selectedTables);

        // 使用 AI 补全描述
        if (enrich && lightSchemaEnricher != null) {
            lightSchemaEnricher.enrich(schemas);
        }

        // 保存到 MongoDB (如果可用)
        if (lightSchemaPersistenceService != null && projectId != null && datasourceId != null) {
            if (incremental) {
                lightSchemaPersistenceService.saveLightSchemasIncremental(projectId, datasourceId, schemas);
            } else {
                lightSchemaPersistenceService.saveLightSchemas(projectId, datasourceId, schemas);
            }
        }

        ContentStore store = runner.getContentStore();
        if (incremental) {
            // 仅删除选中表（按 datasource_id + table_name 过滤）
            List<String> generatedTables = schemas.stream()
                    .map(LightSchema::getTableName)
                    .collect(java.util.stream.Collectors.toList());
            store.removeLightSchemas(datasourceId, generatedTables);
        } else {
            // 仅清空当前数据源（不影响项目内其他数据源）
            store.removeAllLightSchemas(datasourceId);
        }
        store.addLightSchemas(datasourceId, schemas);

        String message = "Generated " + schemas.size() + " Light Schemas for datasource: " + datasourceId
                + (incremental ? " (incremental update)" : " (full rebuild)");
        if (enrich && lightSchemaEnricher != null) {
            message += " (AI-enriched with descriptions)";
        }
        return message;
    }

    /**
     * 向量化数据库单元格值。
     * tableNames 非空时只向量化选中表；为空时向量化该数据源所有表。
     * 无论哪种模式，都只影响当前数据源（按 datasource_id 过滤）。
     */
    @PostMapping("/cells/vectorize")
    public String vectorizeCells(@RequestParam("projectId") String projectId,
                                 @RequestParam("datasourceId") String datasourceId,
                                 @RequestParam(value = "rowLimit", defaultValue = "100") int rowLimit,
                                 @RequestBody(required = false) VectorizeCellsRequest request) {
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }

        List<String> selectedTables = request == null ? null : request.getTableNames();
        boolean incremental = selectedTables != null && !selectedTables.isEmpty();

        ContentStore store = runner.getContentStore();
        if (incremental) {
            store.removeCells(datasourceId, selectedTables);
        } else {
            store.removeAllCells(datasourceId);
            if (cellTablePersistenceService != null) {
                cellTablePersistenceService.removeAll(projectId, datasourceId);
            }
        }
        cellVectorizationService.vectorize(runner.getDatabaseAdapter(), store, rowLimit, selectedTables);

        // 记录"已向量化"状态到 MongoDB
        if (cellTablePersistenceService != null) {
            List<String> doneTables;
            if (incremental) {
                doneTables = selectedTables;
            } else {
                try {
                    doneTables = runner.getDatabaseAdapter().getTableNames();
                } catch (java.sql.SQLException e) {
                    doneTables = java.util.Collections.emptyList();
                    log.warn("Failed to list tables for cell-tables tracking: {}", e.getMessage());
                }
            }
            cellTablePersistenceService.markVectorized(projectId, datasourceId, doneTables);
        }

        return "Cell vectorization completed for datasource: " + datasourceId
                + (incremental ? " (selected " + selectedTables.size() + " tables)" : " (all tables)");
    }

    /**
     * 清空 Light Schema 和单元格向量。只清当前数据源，不影响项目内其他数据源。
     */
    @DeleteMapping("/preprocessing/clear")
    public String clearPreprocessing(@RequestParam("projectId") String projectId,
                                     @RequestParam("datasourceId") String datasourceId) {
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }
        ContentStore store = runner.getContentStore();
        store.removeAllLightSchemas(datasourceId);
        store.removeAllCells(datasourceId);
        if (lightSchemaPersistenceService != null) {
            lightSchemaPersistenceService.removeLightSchemas(projectId, datasourceId);
        }
        if (cellTablePersistenceService != null) {
            cellTablePersistenceService.removeAll(projectId, datasourceId);
        }
        return "Cleared Light Schemas and Cells for datasource: " + datasourceId;
    }

    /**
     * 获取数据源的所有 Light Schema（按 datasource_id 过滤）。
     * 直接读 MongoDB，绕过向量库的全表扫——LightSchema 在 Mongo 里是权威存储，
     * 向量库只用于 /ask 时的语义检索。
     */
    @GetMapping("/light-schema/list")
    public List<LightSchema> listLightSchemas(@RequestParam("projectId") String projectId,
                                              @RequestParam("datasourceId") String datasourceId) {
        if (lightSchemaPersistenceService != null) {
            return lightSchemaPersistenceService.getLightSchemas(projectId, datasourceId);
        }
        // 回退：未启用 MongoDB 持久化（文件模式）时，从 ContentStore 读
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }
        return runner.getContentStore().allLightSchemas(datasourceId);
    }

    /**
     * 获取数据源的所有 schema 列表（按需加载模式，先选 schema 再选表）。
     */
    @GetMapping("/datasource/schemas")
    public List<String> listDatasourceSchemas(@RequestParam("projectId") String projectId,
                                                @RequestParam("datasourceId") String datasourceId) {
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }
        try {
            return runner.getDatabaseAdapter().getSchemas();
        } catch (java.sql.SQLException e) {
            throw new RuntimeException("Failed to list schemas for datasource " + datasourceId + ": " + e.getMessage(), e);
        }
    }

    /**
     * 获取数据源的表名列表（供 UI 多选生成使用）。
     * 传入 schema 时只返回该 schema 下的表（PostgreSQL/GaussDB 多模式场景）；
     * 不传 schema 时保持旧行为，返回当前作用域下的全部表。
     */
    @GetMapping("/datasource/tables")
    public List<String> listDatasourceTables(@RequestParam("projectId") String projectId,
                                             @RequestParam("datasourceId") String datasourceId,
                                             @RequestParam(value = "schema", required = false) String schema) {
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }
        try {
            return runner.getDatabaseAdapter().getTableNames(schema);
        } catch (java.sql.SQLException e) {
            throw new RuntimeException("Failed to list tables for datasource " + datasourceId + ": " + e.getMessage(), e);
        }
    }

    /**
     * 获取该数据源下已被向量化过单元格的表名集合（供 UI 展示"已向量化"状态）。
     * 优先走 MongoDB 跟踪表（O(1) 查询），未启用 MongoDB 时回退到向量库扫描。
     */
    @GetMapping("/cells/tables")
    public List<String> listCellTables(@RequestParam("projectId") String projectId,
                                       @RequestParam("datasourceId") String datasourceId) {
        if (cellTablePersistenceService != null) {
            return new java.util.ArrayList<>(
                    cellTablePersistenceService.listVectorizedTables(projectId, datasourceId));
        }
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found: " + projectId);
        }
        return runner.getContentStore().cellTables(datasourceId);
    }



    @GetMapping("/docs/supported-formats")

    public List<String> getSupportedFormats() {
        return documentParseService.getSupportedExtensions();
    }

    // ============ Helper ============

    private ContentStore getContentStore(@NonNull String projectId) {
        ProjectRunner runner = projectService.getProjectRunner(projectId);
        if (runner == null) {
            throw new IllegalArgumentException("Project not found or not initialized: " + projectId);
        }
        return runner.getContentStore();
    }

    @Data
    public static class DocRequest {
        private String content;
    }

    @Data
    public static class GenerateLightSchemaRequest {
        /** 选中的表名列表；为 null 或空时表示对该数据源所有表执行全量重建。 */
        private List<String> tableNames;
    }

    @Data
    public static class VectorizeCellsRequest {
        /** 选中的表名列表；为 null 或空时表示对该数据源所有表执行单元格向量化。 */
        private List<String> tableNames;
    }

    @Data
    public static class UploadResult {
        private final String id;
        private final String filename;
        private final int contentLength;
        
        public UploadResult(String id, String filename, int contentLength) {
            this.id = id;
            this.filename = filename;
            this.contentLength = contentLength;
        }
    }
}
