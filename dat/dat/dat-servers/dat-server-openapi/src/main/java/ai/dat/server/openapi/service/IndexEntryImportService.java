package ai.dat.server.openapi.service;

import ai.dat.core.contentstore.data.IndexEntry;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.*;

/**
 * 指标库 Excel 导入服务。
 * <p>
 * 解析业务方上传的"指标库.xlsx",每行对应一个 {@link IndexEntry}。
 * 字段映射(中/英文表头通配):
 * <ul>
 *   <li>指标编码 / index_number     → indexNumber (必填)</li>
 *   <li>指标名称 / standard_name    → standardName (必填)</li>
 *   <li>指标别名 / aliases          → aliases (可选,"/" 分隔,自动去重 + 剔除等于 standardName 的项)</li>
 *   <li>指标来源 / source           → source (可选,Integer)</li>
 *   <li>指标频率 / frequency        → frequency (可选,日/月/旬/季)</li>
 *   <li>同业指标表头: 指标编号 → indexNumber, 指标 → standardName, 指标分词 → aliases</li>
 * </ul>
 *
 * <p>解析容错:
 * <ul>
 *   <li><b>逐 sheet 表头预检</b>:先扫描表头判断该 sheet 是否"像指标 sheet"。
 *       两个必填字段(indexNumber + standardName,中/英文/同业别名通配)都在 → 正常解析;
 *       一个都没有(如"目录/说明"sheet)→ 静默跳过,不影响整批;
 *       像指标 sheet 但缺必填列 → 记入 {@code headerErrors}(具体列出缺哪些表头),跳过该 sheet 行解析,
 *       不再因单个 sheet 表头不对而中止整批导入;</li>
 *   <li>整本工作簿没有任何可导入的指标 sheet → 抛 {@link IllegalArgumentException},
 *       消息汇总每个 sheet 缺失的表头,提示具体缺少什么;</li>
 *   <li>空行(所有单元格为空)→ 计入 {@code skippedRows},不进 errors;</li>
 *   <li>单行缺必填值 → 进 {@code errors},不影响其他行成功导入;</li>
 *   <li>未知表头 → 静默忽略。</li>
 * </ul>
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@Service
public class IndexEntryImportService {

    private static final int MAX_SHEETS_TO_PARSE = 2;

    /** 同义表头:多个中/英文同 → 同一逻辑字段 key。 */
    private static final Map<String, Set<String>> HEADER_ALIASES = new LinkedHashMap<>();

    private static final String FIELD_INDEX_NUMBER = "indexNumber";
    private static final String FIELD_STANDARD_NAME = "standardName";
    private static final String FIELD_ALIASES = "aliases";
    private static final String FIELD_SOURCE = "source";
    private static final String FIELD_FREQUENCY = "frequency";

    /** 必填字段(逻辑 key)。 */
    private static final List<String> REQUIRED_FIELDS = List.of(FIELD_INDEX_NUMBER, FIELD_STANDARD_NAME);

    /**
     * 必填字段缺失时给用户的友好提示:把逻辑字段及其同义表头一起列出,
     * 方便业务方对照自己的 Excel(标准格式 vs 同业格式 vs 英文)补齐。
     */
    private static final Map<String, String> MISSING_FIELD_HINT = Map.of(
            FIELD_INDEX_NUMBER, "指标编码(同业格式为\"指标编号\",英文为 index_number)",
            FIELD_STANDARD_NAME, "指标名称(同业格式为\"指标\",英文为 standard_name)");

    /** 别名常见分隔符:"/" 是测试约定主分隔符,其它符号容错。 */
    private static final String ALIAS_SPLIT_REGEX = "[/,;、，；]";

    static {
        HEADER_ALIASES.put(FIELD_INDEX_NUMBER, Set.of("指标编码", "指标编号", "index_number", "indexNumber"));
        HEADER_ALIASES.put(FIELD_STANDARD_NAME, Set.of("指标名称", "指标", "standard_name", "standardName"));
        HEADER_ALIASES.put(FIELD_ALIASES, Set.of("指标别名", "指标分词", "aliases", "alias"));
        HEADER_ALIASES.put(FIELD_SOURCE, Set.of("指标来源", "source"));
        HEADER_ALIASES.put(FIELD_FREQUENCY, Set.of("指标频率", "frequency", "freq"));
    }

    private static final DataFormatter DATA_FORMATTER = new DataFormatter();

    // ─── 入口 ────────────────────────────────────────────────────────────

    /** 从 MultipartFile 解析。 */
    public ParseResult parseFile(MultipartFile file) throws IOException {
        try (InputStream in = file.getInputStream();
             Workbook wb = new XSSFWorkbook(in)) {
            return parseWorkbook(wb);
        }
    }

    /** 从已打开的 Workbook 解析(测试也走这个入口,避免 MockMultipartFile 复杂度)。 */
    public ParseResult parseWorkbook(Workbook wb) {
        int sheetCount = Math.min(wb.getNumberOfSheets(), MAX_SHEETS_TO_PARSE);
        if (sheetCount == 0) {
            return ParseResult.builder()
                    .entries(Collections.emptyList())
                    .errors(Collections.emptyList())
                    .headerErrors(Collections.emptyList())
                    .skippedRows(0)
                    .build();
        }

        List<IndexEntry> entries = new ArrayList<>();
        List<ParseError> errors = new ArrayList<>();
        List<String> headerErrors = new ArrayList<>();
        int skipped = 0;
        int importableSheets = 0;

        for (int sheetIndex = 0; sheetIndex < sheetCount; sheetIndex++) {
            Sheet sheet = wb.getSheetAt(sheetIndex);
            if (sheet == null) {
                continue;
            }

            // 1. 解析表头,把"显示名"映射到"列下标"
            Row header = sheet.getRow(0);
            if (header == null) {
                headerErrors.add("sheet\"" + sheet.getSheetName() + "\"没有表头行,无法导入");
                continue;
            }
            Map<String, Integer> fieldToColumn = parseHeader(header);

            // 2. 表头预检:判断该 sheet 是否支持导入
            boolean hasIndexNumber = fieldToColumn.containsKey(FIELD_INDEX_NUMBER);
            boolean hasStandardName = fieldToColumn.containsKey(FIELD_STANDARD_NAME);
            boolean hasAnyIndicatorField = hasIndexNumber || hasStandardName
                    || fieldToColumn.containsKey(FIELD_ALIASES);

            if (hasIndexNumber && hasStandardName) {
                // 两个必填字段都在(标准格式或同业格式)→ 正常解析
                importableSheets++;
            } else if (!hasAnyIndicatorField) {
                // 一个指标表头都没有(如"目录/说明"sheet)→ 静默跳过,不当作错误
                continue;
            } else {
                // 像指标 sheet 但缺必填列 → 具体提示缺哪些表头,跳过该 sheet 行解析
                List<String> missing = new ArrayList<>();
                for (String req : REQUIRED_FIELDS) {
                    if (!fieldToColumn.containsKey(req)) {
                        missing.add(MISSING_FIELD_HINT.get(req));
                    }
                }
                headerErrors.add("sheet\"" + sheet.getSheetName()
                        + "\"表头不支持导入,缺少必填列: " + String.join("; ", missing));
                continue;
            }

            // 3. 逐行解析
            int lastRow = sheet.getLastRowNum();
            for (int r = 1; r <= lastRow; r++) {
                Row row = sheet.getRow(r);
                if (isBlankRow(row)) {
                    skipped++;
                    continue;
                }
                try {
                    IndexEntry entry = parseRow(row, fieldToColumn);
                    entries.add(entry);
                } catch (Exception e) {
                    // rowNumber 用 1-based,与 Excel UI 行号一致(header=1,首条数据=2,...)
                    errors.add(ParseError.builder()
                            .rowNumber(r + 1)
                            .message("sheet=" + sheet.getSheetName() + ": " + e.getMessage())
                            .build());
                }
            }
        }

        // 整本工作簿没有任何可导入的指标 sheet → 抛错,消息汇总具体缺哪些表头
        if (importableSheets == 0) {
            String detail = headerErrors.isEmpty()
                    ? "前 " + sheetCount + " 个 sheet 均未识别到指标表头(需要 指标编码/指标名称 或同业的 指标编号/指标)"
                    : String.join("; ", headerErrors);
            throw new IllegalArgumentException("Excel 不支持导入: " + detail);
        }

        return ParseResult.builder()
                .entries(entries)
                .errors(errors)
                .headerErrors(headerErrors)
                .skippedRows(skipped)
                .build();
    }

    // ─── 别名解析(静态,便于单测直接覆盖) ──────────────────────────────────

    /**
     * 解析单元格里的别名字符串。
     * 规则:
     * <ol>
     *   <li>null/全空白 → 空列表;</li>
     *   <li>按 {@link #ALIAS_SPLIT_REGEX} 切分,trim 每段;</li>
     *   <li>剔除空字符串、剔除等于 standardName 的项;</li>
     *   <li>保序去重。</li>
     * </ol>
     */
    public static List<String> parseAliases(String raw, String standardName) {
        if (raw == null || raw.isBlank()) {
            return Collections.emptyList();
        }
        Set<String> seen = new LinkedHashSet<>();
        for (String part : raw.split(ALIAS_SPLIT_REGEX)) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (trimmed.equals(standardName)) {
                continue;
            }
            seen.add(trimmed);
        }
        return new ArrayList<>(seen);
    }

    // ─── 内部工具 ────────────────────────────────────────────────────────

    private Map<String, Integer> parseHeader(Row header) {
        Map<String, Integer> result = new LinkedHashMap<>();
        short last = header.getLastCellNum();
        for (int c = 0; c < last; c++) {
            Cell cell = header.getCell(c);
            if (cell == null) continue;
            String displayed = DATA_FORMATTER.formatCellValue(cell).trim();
            if (displayed.isEmpty()) continue;
            String field = displayToField(displayed);
            if (field != null) {
                result.put(field, c);
            }
            // 未识别表头静默忽略
        }
        return result;
    }

    /** 从"显示名"(中文或英文)反查逻辑字段 key;未知返回 null。 */
    private static String displayToField(String displayed) {
        for (Map.Entry<String, Set<String>> e : HEADER_ALIASES.entrySet()) {
            if (e.getValue().contains(displayed)) {
                return e.getKey();
            }
        }
        return null;
    }

    private IndexEntry parseRow(Row row, Map<String, Integer> fieldToColumn) {
        String indexNumber = readString(row, fieldToColumn.get(FIELD_INDEX_NUMBER));
        String standardName = readString(row, fieldToColumn.get(FIELD_STANDARD_NAME));
        if (indexNumber == null || indexNumber.isBlank()) {
            throw new IllegalArgumentException("缺少指标编码");
        }
        if (standardName == null || standardName.isBlank()) {
            throw new IllegalArgumentException("缺少指标名称");
        }
        String aliasesRaw = readString(row, fieldToColumn.get(FIELD_ALIASES));
        List<String> aliases = parseAliases(aliasesRaw, standardName);
        Integer source = readInteger(row, fieldToColumn.get(FIELD_SOURCE));
        String frequency = readString(row, fieldToColumn.get(FIELD_FREQUENCY));
        return IndexEntry.from(indexNumber.trim(), standardName.trim(), aliases, source,
                frequency == null ? null : frequency.trim());
    }

    /** null 列号 → null;否则用 DataFormatter 取人类可读字符串。 */
    private String readString(Row row, Integer column) {
        if (column == null) return null;
        Cell cell = effectiveCell(row, column);
        if (cell == null) return null;
        String v = DATA_FORMATTER.formatCellValue(cell);
        return v == null ? null : v.trim();
    }

    /** 把单元格按 Integer 读取:数值类型直接转 int,文本类型尝试 parseInt。 */
    private Integer readInteger(Row row, Integer column) {
        if (column == null) return null;
        Cell cell = effectiveCell(row, column);
        if (cell == null) return null;
        if (cell.getCellType() == CellType.NUMERIC) {
            return (int) cell.getNumericCellValue();
        }
        String v = DATA_FORMATTER.formatCellValue(cell).trim();
        if (v.isEmpty()) return null;
        try {
            // 兼容 "1.0" / "1" 两种文本形式
            return (int) Double.parseDouble(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 读取真实单元格；如果当前位置落在合并区域内且为空，则读取合并区域左上角单元格。
     */
    private Cell effectiveCell(Row row, int column) {
        Cell cell = row.getCell(column);
        if (cell != null) {
            String displayed = DATA_FORMATTER.formatCellValue(cell);
            if (displayed != null && !displayed.trim().isEmpty()) {
                return cell;
            }
        }

        Sheet sheet = row.getSheet();
        int rowNum = row.getRowNum();
        for (CellRangeAddress region : sheet.getMergedRegions()) {
            if (region.isInRange(rowNum, column)) {
                Row firstRow = sheet.getRow(region.getFirstRow());
                return firstRow == null ? cell : firstRow.getCell(region.getFirstColumn());
            }
        }
        return cell;
    }

    private boolean isBlankRow(Row row) {
        if (row == null) return true;
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

    // ─── 结果类型 ────────────────────────────────────────────────────────

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ParseResult {
        private List<IndexEntry> entries;
        private List<ParseError> errors;
        /** sheet 级表头错误(如某 sheet 像指标 sheet 但缺必填列)。整批仍可能部分成功。 */
        private List<String> headerErrors;
        private int skippedRows;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ParseError {
        /** 1-based 行号(与 Excel UI 一致)。 */
        private int rowNumber;
        private String message;
    }
}
