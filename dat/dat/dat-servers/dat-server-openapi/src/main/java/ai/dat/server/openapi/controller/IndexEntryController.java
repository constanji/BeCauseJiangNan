package ai.dat.server.openapi.controller;

import ai.dat.boot.ProjectRunner;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.IndexEntry;
import ai.dat.core.contentstore.data.IndexEntryWithId;
import ai.dat.core.contentstore.data.KpiInfoRow;
import ai.dat.project.datastore.service.IndexEntryPersistenceService;
import ai.dat.server.openapi.service.IndexEntryImportService;
import ai.dat.server.openapi.service.KpiInfoImportService;
import ai.dat.server.openapi.service.ProjectService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 指标库管理接口。
 * <p>仅在 {@link IndexEntryPersistenceService} bean 可用时(Mongo 模式)注册。
 *
 * <h3>双写一致性</h3>
 * 所有写入/删除操作同时落两份:
 * <ol>
 *   <li><b>MongoDB</b>(权威源):供 CRUD / 精确路径召回 / 持久化</li>
 *   <li><b>ContentStore 向量库</b>:供问数请求中的语义召回 — 没有它,
 *       {@code IndexContextResolver} 的向量召回路永远返回空,只剩精确路</li>
 * </ol>
 * ContentStore 是 conversation 维度的 bean(在 {@code ProjectRunner} 里),所以
 * 同步逻辑只能放在 Controller 层(能注入 {@code ProjectService})。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/index/entries")
@RequiredArgsConstructor
@ConditionalOnBean(IndexEntryPersistenceService.class)
@Tag(name = "指标库", description = "指标库 CRUD 与 Excel 批量导入")
public class IndexEntryController {

    /**
     * "从数据源表导入指标库"的行数上限。指标字典表设计上是小表，超过这个量级
     * 大概率是选错了表(比如选到明细/结果表)，直接拒绝导入而不是把整表读进内存
     * 导致 OOM 崩溃(见 importFromTable 内的行数护栏)。
     */
    private static final long MAX_IMPORT_TABLE_ROWS = 20_000L;

    private final IndexEntryPersistenceService persistenceService;
    private final IndexEntryImportService importService;
    private final KpiInfoImportService kpiInfoImportService;
    private final ProjectService projectService;
    @Autowired(required = false)
    private ai.dat.core.index.bm25.IndexBm25Index bm25Index;

    @GetMapping
    @Operation(summary = "列出项目下全部指标(带 _id)")
    public List<IndexEntryWithId> list(@RequestParam("projectId") String projectId) {
        return persistenceService.listAllWithId(projectId);
    }

    @PostMapping
    @Operation(summary = "新增/更新单条指标(按 indexNumber upsert)")
    public String upsert(@RequestParam("projectId") String projectId,
                          @RequestBody IndexEntry entry) {
        String id = persistenceService.upsert(projectId, entry);
        syncToContentStore(projectId, List.of(entry), List.of(entry.getIndexNumber()));
        return id;
    }

    @PostMapping("/batch")
    @Operation(summary = "批量新增/更新")
    public int upsertBatch(@RequestParam("projectId") String projectId,
                            @RequestBody List<IndexEntry> entries) {
        int n = persistenceService.upsertAll(projectId, entries).size();
        List<String> nums = entries.stream().map(IndexEntry::getIndexNumber).toList();
        syncToContentStore(projectId, entries, nums);
        return n;
    }

    @PostMapping("/upload")
    @Operation(summary = "上传指标库.xlsx 并入库",
            description = "解析后按 (projectId, indexNumber) 全部 upsert。" +
                    "返回成功/错误/跳过统计,不会因单行错误中断整批。同时同步到 ContentStore 向量库。")
    public UploadResult upload(@RequestParam("projectId") String projectId,
                                @RequestParam("file") MultipartFile file) throws IOException {
        IndexEntryImportService.ParseResult parsed = importService.parseFile(file);
        int upserted = persistenceService.upsertAll(projectId, parsed.getEntries()).size();
        List<String> nums = parsed.getEntries().stream().map(IndexEntry::getIndexNumber).toList();
        syncToContentStore(projectId, parsed.getEntries(), nums);
        return UploadResult.builder()
                .upserted(upserted)
                .skippedRows(parsed.getSkippedRows())
                .errors(parsed.getErrors())
                .headerErrors(parsed.getHeaderErrors())
                .build();
    }

    @PostMapping("/import-kpi-info")
    @Operation(summary = "从数据源表 kpi_info 导入指标库",
            description = "支持上传 SQL dump 文件(INSERT INTO kpi_info VALUES ...)或 JSON 数组。" +
                    "每行按口径标识(kpi_ispbc/kpi_iscbcr/kpi_isrccu)展开为多条 IndexEntry。" +
                    "同时同步到 ContentStore 向量库。")
    public KpiInfoImportResult importKpiInfo(@RequestParam("projectId") String projectId,
                                              @RequestParam("file") MultipartFile file) throws IOException {
        List<IndexEntry> entries = kpiInfoImportService.parseFile(
                file.getInputStream(), file.getOriginalFilename());
        int upserted = persistenceService.upsertAll(projectId, entries).size();
        List<String> nums = entries.stream().map(IndexEntry::getIndexNumber).distinct().toList();
        syncToContentStore(projectId, entries, nums);
        return new KpiInfoImportResult(upserted, entries.size());
    }

    @PostMapping("/import-from-table")
    @Operation(summary = "从数据源中的表直接导入指标库",
            description = "选择项目中的数据源和表名，校验表结构是否符合 kpi_info 规范，" +
                    "通过后读取全表数据、展开口径、导入指标库并同步向量库。")
    public KpiInfoImportResult importFromTable(@RequestBody ImportFromTableRequest request) {
        String projectId = request.getProjectId();
        String datasourceId = request.getDatasourceId();
        String tableName = request.getTableName();

        // 1) 获取 DatabaseAdapter
        ProjectRunner runner = projectService.getProjectRunner(projectId, datasourceId);
        ai.dat.core.adapter.DatabaseAdapter adapter = runner.getDatabaseAdapter();

        // 2) 校验表结构
        List<ai.dat.core.contentstore.data.LightSchema.ColumnInfo> columns;
        try {
            columns = adapter.getColumns(tableName);
        } catch (Exception e) {
            throw new IllegalArgumentException("无法读取表 " + tableName + ": " + e.getMessage());
        }
        List<String> columnNames = columns.stream()
                .map(ai.dat.core.contentstore.data.LightSchema.ColumnInfo::getName)
                .toList();
        if (!KpiInfoRow.hasRequiredColumns(columnNames)) {
            throw new IllegalArgumentException("表 " + tableName + " " + KpiInfoRow.missingColumnsMessage());
        }

        // 源表(如 kpi_result_ctcx)通常是按期快照的宽表：同一个指标编码在每个
        // data_dt 各有一行，本质是"指标结果历史"而不是"指标字典"。直接 SELECT *
        // 会把全部历史期数一次性物化进 JVM 堆——不仅数据重复(下面按口径展开时
        // 同一编码会被处理成千上万次)，表稍微大一点(几年 × 上千指标 × 多机构)
        // 就会把 2G 堆打满 OOM，还是整进程级联失败，不只是这一个请求报错。
        // 因此这里按指标编码去重、只取最新一期，同时只选指标定义相关列(不用
        // SELECT *)，参照的是旧版 Because-2.0 TableExtractService.js 里
        // extractKpiDefinition 的做法(DISTINCT ON codeCol ORDER BY data_dt DESC)，
        // 这里用标准 ROW_NUMBER() 窗口函数实现同样效果，兼容 MySQL/Oracle 等更多方言。
        String codeCol = KpiInfoRow.resolveCodeColumn(columnNames);
        String dataDtCol = columnNames.stream()
                .filter(c -> c != null && c.equalsIgnoreCase("data_dt"))
                .findFirst()
                .orElse(null);
        List<String> selectColumns = new ArrayList<>(KpiInfoRow.resolveRelevantColumns(columnNames));
        if (dataDtCol != null && !selectColumns.contains(dataDtCol)) {
            selectColumns.add(dataDtCol);
        }

        // 行数护栏：去重后真正会被物化进内存的是"不同指标编码数"，而不是原表总行数，
        // 这里按去重键的 distinct 数量做前置校验，超阈值直接给清晰错误。
        try {
            List<Map<String, Object>> countResult = adapter.executeQuery(
                    "SELECT COUNT(DISTINCT " + codeCol + ") FROM " + tableName);
            long distinctCount = countResult.isEmpty() || countResult.get(0).isEmpty()
                    ? 0L
                    : Long.parseLong(String.valueOf(countResult.get(0).values().iterator().next()));
            if (distinctCount > MAX_IMPORT_TABLE_ROWS) {
                throw new IllegalArgumentException(String.format(
                        "表 %s 有 %d 个不同的指标编码，超过指标库导入上限(%d)。"
                                + "请确认选表是否正确；确需导入大表请改用 Excel 分批导入",
                        tableName, distinctCount, MAX_IMPORT_TABLE_ROWS));
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.warn("统计表 {} 指标编码数失败，跳过行数护栏直接尝试导入: {}", tableName, e.getMessage());
        }

        // 3) 读取数据(按指标编码去重，只取最新一期)
        String selectSql = buildDedupSelectSql(tableName, codeCol, dataDtCol, selectColumns);
        List<Map<String, Object>> rows;
        try {
            rows = adapter.executeQuery(selectSql);
        } catch (Exception e) {
            throw new RuntimeException("读取表数据失败: " + e.getMessage());
        }

        // 4) 列名 → kpi_info 字段映射(兼容 kpi_code/kpi_name 与 index_number/standard_name 两套命名)
        List<KpiInfoRow> kpiInfoRows = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            kpiInfoRows.add(KpiInfoRow.fromRow(row));
        }

        // 5) 展开为 IndexEntry
        List<IndexEntry> entries = new ArrayList<>();
        for (KpiInfoRow kr : kpiInfoRows) {
            entries.addAll(kr.toIndexEntries());
        }

        // 6) 入库 + 向量同步
        int upserted = persistenceService.upsertAll(projectId, entries).size();
        List<String> nums = entries.stream().map(IndexEntry::getIndexNumber).distinct().toList();
        syncToContentStore(projectId, entries, nums);

        return new KpiInfoImportResult(upserted, entries.size());
    }

    /**
     * 构造"按指标编码去重、只取最新一期"的查询：用标准 {@code ROW_NUMBER()} 窗口函数
     * 而不是 PostgreSQL 专有的 {@code DISTINCT ON}，以兼容 DAT 支持的多种数据源方言
     * (MySQL 8+ / PostgreSQL / Oracle / GaussDB 均支持窗口函数)。
     */
    private static String buildDedupSelectSql(String tableName, String codeCol, String dataDtCol,
                                               List<String> selectColumns) {
        String columnList = selectColumns.isEmpty() ? "*" : String.join(", ", selectColumns);
        String orderBy = dataDtCol != null ? (dataDtCol + " DESC") : codeCol;
        return "SELECT " + columnList + " FROM ("
                + "SELECT " + columnList + ", ROW_NUMBER() OVER (PARTITION BY " + codeCol
                + " ORDER BY " + orderBy + ") AS rn__ FROM " + tableName
                + ") dedup_sub WHERE rn__ = 1";
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "按 _id 删除")
    public void removeById(@PathVariable("id") String id,
                            @RequestParam(value = "projectId", required = false) String projectId) {
        // 删除前先查 indexNumber,用于同步删除向量库
        String indexNumber = persistenceService.listAllWithId(projectId == null ? "" : projectId).stream()
                .filter(e -> id.equals(e.getId()))
                .map(IndexEntryWithId::getIndexNumber)
                .findFirst()
                .orElse(null);
        persistenceService.removeById(id);
        if (projectId != null && indexNumber != null) {
            withContentStore(projectId, cs -> cs.removeIndexEntries(projectId, List.of(indexNumber)));
        }
    }

    @DeleteMapping
    @Operation(summary = "按 indexNumber 批量删除(?indexNumbers=KPI0001,KPI0002)")
    public void removeByIndexNumbers(@RequestParam("projectId") String projectId,
                                       @RequestParam(value = "indexNumbers", required = false)
                                       Collection<String> indexNumbers) {
        if (indexNumbers == null || indexNumbers.isEmpty()) {
            return;
        }
        persistenceService.removeByIndexNumbers(projectId, indexNumbers);
        withContentStore(projectId, cs -> cs.removeIndexEntries(projectId, indexNumbers));
    }

    @DeleteMapping("/all")
    @Operation(summary = "清空项目下全部指标(危险操作)")
    public void removeAll(@RequestParam("projectId") String projectId) {
        persistenceService.removeAll(projectId);
        withContentStore(projectId, cs -> cs.removeAllIndexEntries(projectId));
    }

    // ─── 双写同步辅助 ────────────────────────────────────────────────────

    /**
     * 同步指标到 ContentStore 向量库。
     * <p>upsert 语义:先按 indexNumber 删除旧向量,再写入新向量;否则会留下重复的旧条目。
     * 任何异常都吞掉记 warn —— Mongo 已写入是事实,向量库失败不应让 200 变 500。
     */
    private void syncToContentStore(String projectId, List<IndexEntry> entries, List<String> indexNumbers) {
        if (entries == null || entries.isEmpty()) return;
        withContentStore(projectId, cs -> {
            cs.removeIndexEntries(projectId, indexNumbers);
            cs.addIndexEntries(projectId, entries);
        });
        // 同步更新 BM25 倒排索引
        if (bm25Index != null) {
            bm25Index.removeAll(indexNumbers);
            bm25Index.addAll(entries);
        }
    }

    /** 解析 ContentStore 并在 try-catch 内执行操作,失败仅 warn。 */
    private void withContentStore(String projectId, java.util.function.Consumer<ContentStore> action) {
        try {
            ProjectRunner runner = projectService.getProjectRunner(projectId);
            if (runner == null) {
                log.warn("ProjectRunner not found for projectId={}, skip ContentStore sync", projectId);
                return;
            }
            ContentStore cs = runner.getContentStore();
            if (cs == null) {
                log.warn("ContentStore is null for projectId={}, skip sync", projectId);
                return;
            }
            action.accept(cs);
        } catch (UnsupportedOperationException uoe) {
            // 向量库未注入是合理状态(项目未配置 indexEntryEmbeddingStore),静默跳过
            log.debug("ContentStore index entry store not configured for {}", projectId);
        } catch (Exception e) {
            log.warn("ContentStore index entry sync failed for {}: {}", projectId, e.getMessage());
        }
    }

    // ─── 返回类型 ────────────────────────────────────────────────────────

    @Data
    @lombok.Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UploadResult {
        private int upserted;
        private int skippedRows;
        private List<IndexEntryImportService.ParseError> errors;
        /** sheet 级表头警告(某 sheet 表头不支持导入时具体提示缺哪些表头)。 */
        private List<String> headerErrors;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class KpiInfoImportResult {
        private int upserted;
        private int totalEntries;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportFromTableRequest {
        private String projectId;
        private String datasourceId;
        private String tableName;
    }

}
