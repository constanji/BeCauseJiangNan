package ai.dat.server.openapi.service;

import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.*;

/**
 * 从 Excel 导入机构信息。
 *
 * <h3>支持的源文件</h3>
 * 从 {@code c_par_brch_level} 表导出的 Excel（.xlsx）。首行为表头，必填列:
 * {@code data_dt, brchno, brchna, brchup, brchlv}。允许包含额外列，但必填列缺失会抛异常。
 *
 * <h3>处理逻辑</h3>
 * <ul>
 *   <li>校验表头必须包含全部必填列；</li>
 *   <li>取 Excel 中最大 {@code data_dt} 作为该批次快照日期；</li>
 *   <li>仅保留该最大日期的行，按 {@code orgCode} 去重；</li>
 *   <li>字段映射、dataScope 派生与数据源表导入保持一致。</li>
 * </ul>
 *
 * @Author DAT Team
 * @Date 2026/7/15
 */
@Slf4j
@Service
public class OrgNodeExcelImportService {

    /** 必填列（与 c_par_brch_level 表一致）。 */
    private static final Set<String> REQUIRED_COLUMNS = Set.of(
            "data_dt", "brchno", "brchna", "brchup", "brchlv");

    private static final DataFormatter DATA_FORMATTER = new DataFormatter();

    /**
     * 从上传的 Excel 文件导入机构信息。
     *
     * @param file      Excel 文件（.xlsx）
     * @param projectId 项目 ID
     * @return 导入结果
     * @throws IllegalArgumentException 表头不符合要求
     * @throws RuntimeException         读取 Excel 失败
     */
    public OrgNodeFromTableImportService.ImportResult importFromExcel(MultipartFile file, String projectId) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("上传文件不能为空");
        }
        String originalName = file.getOriginalFilename();
        if (originalName == null || !originalName.toLowerCase().endsWith(".xlsx")) {
            throw new IllegalArgumentException("仅支持 .xlsx 格式的 Excel 文件");
        }

        List<Map<String, Object>> rows;
        try (InputStream in = file.getInputStream();
             Workbook wb = new XSSFWorkbook(in)) {
            rows = parseWorkbook(wb);
        } catch (IOException e) {
            throw new RuntimeException("读取 Excel 文件失败: " + e.getMessage(), e);
        }

        if (rows.isEmpty()) {
            return OrgNodeFromTableImportService.ImportResult.builder()
                    .nodes(Collections.emptyList())
                    .dataDt(null)
                    .build();
        }

        // 取最大 data_dt 作为快照日期(先归一化为 yyyy-MM-dd，避免 Excel 日期单元格
        // "2026-07-10 00:00:00" 与数据源 "2026-07-10" 被当成两个快照导致跨来源重复)
        String latestDataDt = rows.stream()
                .map(r -> OrgNodeFromTableImportService.normalizeDataDt(Objects.toString(r.get("data_dt"), null)))
                .filter(s -> s != null && !s.isBlank())
                .max(Comparator.naturalOrder())
                .orElse(null);
        if (latestDataDt == null || latestDataDt.isBlank()) {
            return OrgNodeFromTableImportService.ImportResult.builder()
                    .nodes(Collections.emptyList())
                    .dataDt(null)
                    .build();
        }

        final String dt = latestDataDt;
        rows = rows.stream()
                .filter(r -> dt.equals(OrgNodeFromTableImportService.normalizeDataDt(
                        Objects.toString(r.get("data_dt"), null))))
                .toList();

        return OrgNodeFromTableImportService.buildNodesFromRows(rows, projectId, latestDataDt, originalName);
    }

    private List<Map<String, Object>> parseWorkbook(Workbook wb) {
        Sheet sheet = wb.getSheetAt(0);
        if (sheet == null) {
            throw new IllegalArgumentException("Excel 文件没有工作表");
        }

        Row header = sheet.getRow(0);
        if (header == null) {
            throw new IllegalArgumentException("Excel 工作表没有表头行");
        }

        Map<String, Integer> colIndex = parseHeader(header);
        Set<String> missing = new HashSet<>();
        for (String req : REQUIRED_COLUMNS) {
            if (!colIndex.containsKey(req)) {
                missing.add(req);
            }
        }
        if (!missing.isEmpty()) {
            throw new IllegalArgumentException(
                    "Excel 表头不符合 c_par_brch_level 规范，缺少必填列: " + missing);
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        int lastRow = sheet.getLastRowNum();
        for (int r = 1; r <= lastRow; r++) {
            Row row = sheet.getRow(r);
            if (row == null || isBlankRow(row)) {
                continue;
            }
            Map<String, Object> rowMap = new LinkedHashMap<>();
            for (Map.Entry<String, Integer> e : colIndex.entrySet()) {
                rowMap.put(e.getKey(), readCellValue(row.getCell(e.getValue())));
            }
            rows.add(rowMap);
        }
        return rows;
    }

    private Map<String, Integer> parseHeader(Row header) {
        Map<String, Integer> result = new LinkedHashMap<>();
        short last = header.getLastCellNum();
        for (int c = 0; c < last; c++) {
            Cell cell = header.getCell(c);
            if (cell == null) continue;
            String value = DATA_FORMATTER.formatCellValue(cell).trim();
            if (value.isEmpty()) continue;
            result.put(value.toLowerCase(), c);
        }
        return result;
    }

    private Object readCellValue(Cell cell) {
        if (cell == null) return null;
        if (cell.getCellType() == CellType.NUMERIC) {
            // 日期类型按 yyyy-MM-dd HH:mm:ss 格式化，与 data_dt 兼容
            if (org.apache.poi.ss.usermodel.DateUtil.isCellDateFormatted(cell)) {
                return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(cell.getDateCellValue());
            }
            double v = cell.getNumericCellValue();
            if (v == Math.floor(v) && !Double.isInfinite(v)) {
                return String.valueOf((long) v);
            }
            return String.valueOf(v);
        }
        String formatted = DATA_FORMATTER.formatCellValue(cell);
        return formatted == null || formatted.isBlank() ? null : formatted.trim();
    }

    private boolean isBlankRow(Row row) {
        short last = row.getLastCellNum();
        if (last <= 0) return true;
        for (int c = 0; c < last; c++) {
            Cell cell = row.getCell(c);
            if (cell == null) continue;
            String v = DATA_FORMATTER.formatCellValue(cell);
            if (v != null && !v.trim().isEmpty()) {
                return false;
            }
        }
        return true;
    }
}
