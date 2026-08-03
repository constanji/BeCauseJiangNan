package ai.dat.server.openapi.service;

import ai.dat.core.contentstore.data.IndexEntry;
import ai.dat.core.contentstore.data.KpiInfoRow;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * kpi_info 数据源导入服务。
 * <p>支持两种输入格式:
 * <ul>
 *   <li>SQL dump 文件(INSERT INTO kpi_info VALUES ...)</li>
 *   <li>JSON 数组([{kpi_code:..., kpi_name:...}, ...])</li>
 * </ul>
 * 输出: 展开为 {@link IndexEntry} 列表,每种口径生成一条记录。
 *
 * @Author DAT Team
 * @Date 2026/6/23
 */
@Slf4j
@Service
public class KpiInfoImportService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 匹配 INSERT INTO `kpi_info` VALUES ( ... ) 的行 */
    private static final Pattern INSERT_VALUES = Pattern.compile(
            "INSERT\\s+INTO\\s+`?kpi_info`?\\s+VALUES\\s*\\((.+?)\\)\\s*;?\\s*$",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    @Data
    public static class ImportResult {
        private final int totalRows;
        private final int kpiInfoRows;
        private final int indexEntries;
        private final List<String> errors;

        public ImportResult(int totalRows, int kpiInfoRows, int indexEntries, List<String> errors) {
            this.totalRows = totalRows;
            this.kpiInfoRows = kpiInfoRows;
            this.indexEntries = indexEntries;
            this.errors = errors;
        }
    }

    /**
     * 解析上传的文件(JSON 或 SQL dump)，展开为 IndexEntry 列表。
     */
    public List<IndexEntry> parseFile(InputStream inputStream, String originalFilename) throws IOException {
        String content = readAll(inputStream);
        if (originalFilename != null && (originalFilename.endsWith(".json") || content.trim().startsWith("["))) {
            return parseJson(content);
        }
        // 默认按 SQL dump 解析
        return parseSql(content);
    }

    /**
     * 从 JSON 数组解析 KpiInfoRow → IndexEntry。
     */
    public List<IndexEntry> parseJson(String json) throws IOException {
        List<KpiInfoRow> rows = MAPPER.readValue(json, new TypeReference<List<KpiInfoRow>>() {});
        return expandToIndexEntries(rows);
    }

    /**
     * 从 SQL dump 解析 INSERT INTO kpi_info VALUES 行。
     */
    List<IndexEntry> parseSql(String sql) {
        List<KpiInfoRow> rows = new ArrayList<>();
        for (String line : sql.split("\n")) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("--") || line.startsWith("SET ") || line.startsWith("DROP ") || line.startsWith("CREATE ")) {
                continue;
            }
            Matcher m = INSERT_VALUES.matcher(line);
            if (!m.find()) continue;

            String valuesPart = m.group(1);
            List<String> fields = splitValues(valuesPart);
            if (fields.size() < 10) {
                log.warn("Skipping INSERT row with insufficient columns: {}", line.substring(0, Math.min(100, line.length())));
                continue;
            }
            // 字段顺序: crcycd(1), crcyen(2) ... 不对，这是 kpi_info 表
            // kpi_info 字段顺序: kpi_code, kpi_name, kpi_freq, kpi_desc, kpi_rule, kpi_ispbc, kpi_iscbcr, kpi_isrccu, kpi_deptmt, kpi_remark, kpi_category, kpi_relation
            String kpiCode = unquote(fields.get(0));
            String kpiName = unquote(fields.get(1));
            String kpiFreq = unquote(fields.get(2));
            String kpiDesc = fields.size() > 3 ? unquote(fields.get(3)) : null;
            String kpiRule = fields.size() > 4 ? unquote(fields.get(4)) : null;
            Boolean kpiIspbc = fields.size() > 5 ? parseBool(fields.get(5)) : false;
            Boolean kpiIscbcr = fields.size() > 6 ? parseBool(fields.get(6)) : false;
            Boolean kpiIsrccu = fields.size() > 7 ? parseBool(fields.get(7)) : false;
            String kpiDeptmt = fields.size() > 8 ? unquote(fields.get(8)) : null;
            String kpiRemark = fields.size() > 9 ? unquote(fields.get(9)) : null;
            String kpiCategory = fields.size() > 10 ? unquote(fields.get(10)) : null;
            String kpiRelation = fields.size() > 11 ? unquote(fields.get(11)) : null;

            rows.add(new KpiInfoRow(kpiCode, kpiName, kpiFreq, kpiDesc, kpiRule,
                    kpiIspbc, kpiIscbcr, kpiIsrccu, kpiDeptmt, kpiRemark, kpiCategory, kpiRelation));
        }
        return expandToIndexEntries(rows);
    }

    /**
     * 将 KpiInfoRow 列表展开为 IndexEntry 列表（口径展开）。
     */
    private List<IndexEntry> expandToIndexEntries(List<KpiInfoRow> rows) {
        List<IndexEntry> entries = new ArrayList<>();
        for (KpiInfoRow row : rows) {
            entries.addAll(row.toIndexEntries());
        }
        return entries;
    }

    /** 解析 INSERT VALUES 中的字段列表（处理括号内逗号、字符串引号）。 */
    static List<String> splitValues(String valuesPart) {
        List<String> fields = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuote = false;
        int parenDepth = 0;
        for (int i = 0; i < valuesPart.length(); i++) {
            char c = valuesPart.charAt(i);
            if (c == '\'' && !inQuote) {
                inQuote = true;
                current.append(c);
            } else if (c == '\'' && inQuote) {
                // 检查是否是转义引号 ''
                if (i + 1 < valuesPart.length() && valuesPart.charAt(i + 1) == '\'') {
                    current.append("''");
                    i++;
                } else {
                    inQuote = false;
                    current.append(c);
                }
            } else if (!inQuote && c == '(') {
                parenDepth++;
                current.append(c);
            } else if (!inQuote && c == ')') {
                parenDepth--;
                current.append(c);
            } else if (!inQuote && c == ',' && parenDepth == 0) {
                fields.add(current.toString().trim());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        if (!current.isEmpty()) {
            fields.add(current.toString().trim());
        }
        return fields;
    }

    static String unquote(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("\"") && trimmed.endsWith("\""))) {
            return trimmed.substring(1, trimmed.length() - 1).replace("\\'", "'").replace("''", "'");
        }
        if ("NULL".equalsIgnoreCase(trimmed)) return null;
        return trimmed;
    }

    static Boolean parseBool(String s) {
        if (s == null) return false;
        String trimmed = s.trim();
        if ("1".equals(trimmed) || "true".equalsIgnoreCase(trimmed)) return true;
        if ("0".equals(trimmed) || "false".equalsIgnoreCase(trimmed) || "NULL".equalsIgnoreCase(trimmed)) return false;
        return false;
    }

    private static String readAll(InputStream is) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString();
    }
}
