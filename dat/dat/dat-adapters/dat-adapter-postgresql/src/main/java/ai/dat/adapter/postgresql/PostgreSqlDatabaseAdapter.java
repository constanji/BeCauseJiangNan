package ai.dat.adapter.postgresql;

import ai.dat.core.adapter.GenericSqlDatabaseAdapter;
import ai.dat.core.adapter.data.AnsiSqlType;
import ai.dat.core.contentstore.data.LightSchema;
import org.postgresql.util.PGobject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * PostgreSQL / GaussDB 数据库适配器
 *
 * <p>支持多 schema 扫描：
 * <ul>
 *   <li>通过 Factory 的 {@code schemas} 选项显式指定（"public,kpi,org"）</li>
 *   <li>未配置时自动发现库内所有用户 schema（排除系统 schema）</li>
 *   <li>scope 涵盖 ≥2 个 schema 时，{@link #getTableNames()} 返回 "schema.table" 形式</li>
 *   <li>scope 仅 1 个 schema 时，沿用原始裸表名，保持单 schema 老项目向后兼容</li>
 * </ul>
 *
 * <p>所有按 tableName 取元数据的方法都接受 "schema.table" 或裸 "table"，
 * 前者用前缀路由到对应 schema，后者使用 {@code conn.getSchema()} 默认 schema。
 *
 * @Author JunjieM
 * @Date 2025/7/2
 */
public class PostgreSqlDatabaseAdapter extends GenericSqlDatabaseAdapter {

    private static final Logger log = LoggerFactory.getLogger(PostgreSqlDatabaseAdapter.class);

    private static final Set<String> SYSTEM_SCHEMAS = Set.of(
            "pg_catalog", "information_schema",
            // GaussDB / OpenGauss 系统/扩展 schema
            "dbe_perf", "dbe_pldebugger", "dbe_pldeveloper", "dbe_sql_util",
            "pkg_service", "snapshot", "sqladvisor", "cstore", "db4ai",
            "blockchain", "coverage", "gaussdb", "xmltype", "orclcompatibility",
            "dbms_job", "dbms_om", "dbms_output", "dbms_random", "dbms_sql",
            "util", "pkg_util", "utl_file", "utl_raw", "utl_smime", "utl_url");

    /** 采样值内部硬上限，防止高基数列拉取过量数据导致 OOM。 */
    private static final int MAX_SAMPLE_LIMIT = 100;

    private final List<String> configuredSchemas;
    private volatile List<String> resolvedSchemas;

    public PostgreSqlDatabaseAdapter(DataSource dataSource) {
        this(dataSource, Collections.emptyList());
    }

    public PostgreSqlDatabaseAdapter(DataSource dataSource, List<String> configuredSchemas) {
        super(dataSource);
        this.configuredSchemas = configuredSchemas == null
                ? Collections.emptyList()
                : List.copyOf(configuredSchemas);
    }

    @Override
    public String getDialect() {
        return "PostgreSQL";
    }

    // -------------------------------- schema resolution --------------------------------

    /**
     * 解析本适配器要扫描的 schema 列表（结果缓存）。
     * <ul>
     *   <li>显式配置非空 → 直接用</li>
     *   <li>否则查 {@code pg_namespace}（必要时回退 {@code DatabaseMetaData#getSchemas()}）
     *       并剔除系统 schema</li>
     *   <li>查询失败兜底使用 {@code conn.getSchema()}，再不行则退到 "public"</li>
     * </ul>
     */
    private List<String> resolveSchemas() throws SQLException {
        List<String> cached = this.resolvedSchemas;
        if (cached != null) {
            return cached;
        }
        synchronized (this) {
            if (this.resolvedSchemas != null) {
                return this.resolvedSchemas;
            }
            List<String> schemas;
            if (!configuredSchemas.isEmpty()) {
                schemas = configuredSchemas;
            } else {
                schemas = discoverUserSchemas();
            }
            if (schemas.isEmpty()) {
                schemas = List.of("public");
            }
            this.resolvedSchemas = List.copyOf(schemas);
            log.info("PostgreSQL adapter resolved schemas: {}", this.resolvedSchemas);
            return this.resolvedSchemas;
        }
    }

    private List<String> discoverUserSchemas() throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            List<String> schemas = new ArrayList<>();
            // 优先 pg_namespace：GaussDB 与原生 PG 都支持
            String excluded = SYSTEM_SCHEMAS.stream()
                    .map(s -> "'" + s.replace("'", "''") + "'")
                    .collect(Collectors.joining(","));
            String sql = "SELECT nspname FROM pg_catalog.pg_namespace " +
                    "WHERE nspname NOT IN (" + excluded + ") " +
                    "AND nspname NOT LIKE 'pg_toast%' " +
                    "AND nspname NOT LIKE 'pg_temp%' " +
                    "ORDER BY nspname";
            try (PreparedStatement stmt = conn.prepareStatement(sql);
                    ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    String name = rs.getString(1);
                    if (name != null && !name.isBlank()) {
                        schemas.add(name);
                    }
                }
                return schemas;
            } catch (SQLException e) {
                log.warn("Falling back to DatabaseMetaData#getSchemas (pg_namespace query failed): {}",
                        e.getMessage());
            }
            // 回退 JDBC 元数据
            try (ResultSet rs = conn.getMetaData().getSchemas()) {
                while (rs.next()) {
                    String name = rs.getString("TABLE_SCHEM");
                    if (name == null || name.isBlank()) {
                        continue;
                    }
                    String lower = name.toLowerCase();
                    if (SYSTEM_SCHEMAS.contains(lower)
                            || lower.startsWith("pg_toast")
                            || lower.startsWith("pg_temp")) {
                        continue;
                    }
                    schemas.add(name);
                }
            }
            if (schemas.isEmpty()) {
                String current = conn.getSchema();
                if (current != null && !current.isBlank()) {
                    schemas.add(current);
                }
            }
            return schemas;
        }
    }

    /** scope 跨多个 schema 时表名要带 schema 前缀。 */
    private boolean qualifyTableNames(List<String> schemas) {
        return schemas.size() > 1 || !configuredSchemas.isEmpty();
    }

    /** "schema.table" → [schema, table]；裸 "table" → [null, table]（schema 由调用方兜底）。 */
    private static String[] splitQualified(String tableName) {
        if (tableName == null) {
            return new String[] { null, null };
        }
        int dot = tableName.indexOf('.');
        if (dot <= 0 || dot == tableName.length() - 1) {
            return new String[] { null, tableName };
        }
        return new String[] {
                tableName.substring(0, dot),
                tableName.substring(dot + 1)
        };
    }

    private String resolveSchemaFor(String tableName, Connection conn) throws SQLException {
        String[] parts = splitQualified(tableName);
        if (parts[0] != null) {
            return parts[0];
        }
        String current = conn.getSchema();
        return current == null ? "public" : current;
    }

    private static String bareTable(String tableName) {
        return splitQualified(tableName)[1];
    }

    // -------------------------------- schema-aware public API --------------------------------

    @Override
    public List<String> getSchemas() throws SQLException {
        return resolveSchemas();
    }

    @Override
    public List<String> getTableNames(String schema) throws SQLException {
        if (schema == null || schema.isBlank()) {
            return getTableNames();
        }
        List<String> tables = new ArrayList<>();
        String sql = "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = ? ORDER BY tablename";
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setQueryTimeout(30);
            stmt.setString(1, schema);
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    String name = rs.getString(1);
                    if (name != null) {
                        tables.add(name);
                    }
                }
            }
        }
        return tables;
    }

    // -------------------------------- metadata overrides --------------------------------

    @Override
    public List<String> getTableNames() throws SQLException {
        List<String> schemas = resolveSchemas();
        if (schemas.isEmpty()) {
            return Collections.emptyList();
        }
        boolean qualify = qualifyTableNames(schemas);
        List<String> tables = new ArrayList<>();

        // 先用轻量的 pg_tables 视图查；GaussDB 对多表 JOIN 的 pg_class 可能选错执行计划，
        // 导致单条 SQL 也像"死循环"一样长时间不返回
        StringBuilder sql = new StringBuilder(128);
        sql.append("SELECT schemaname, tablename FROM pg_catalog.pg_tables ")
           .append("WHERE schemaname IN (");
        for (int i = 0; i < schemas.size(); i++) {
            if (i > 0) sql.append(',');
            sql.append('?');
        }
        sql.append(") ORDER BY schemaname, tablename");

        long start = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(sql.toString())) {
            stmt.setQueryTimeout(30);
            for (int i = 0; i < schemas.size(); i++) {
                stmt.setString(i + 1, schemas.get(i));
            }
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    String schema = rs.getString(1);
                    String tableName = rs.getString(2);
                    tables.add(qualify ? schema + "." + tableName : tableName);
                }
            }
            log.info("Listed {} tables across {} schemas via pg_tables in {} ms",
                    tables.size(), schemas.size(), System.currentTimeMillis() - start);
            return tables;
        } catch (SQLException e) {
            log.warn("pg_tables query failed after {} ms, falling back to per-schema metadata: {}",
                    System.currentTimeMillis() - start, e.getMessage());
            return getTableNamesViaMetadata(schemas, qualify);
        }
    }

    /**
     * 通过 DatabaseMetaData 逐 schema 获取表名（兜底方案，与 35a1b949 原始实现一致）。
     */
    private List<String> getTableNamesViaMetadata(List<String> schemas, boolean qualify) throws SQLException {
        List<String> tables = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData metaData = conn.getMetaData();
            for (String schema : schemas) {
                long start = System.currentTimeMillis();
                try (ResultSet rs = metaData.getTables(conn.getCatalog(), schema, "%",
                        new String[] { "TABLE" })) {
                    while (rs.next()) {
                        String name = rs.getString("TABLE_NAME");
                        if (name == null) continue;
                        tables.add(qualify ? schema + "." + name : name);
                    }
                    log.debug("Listed tables in schema [{}] in {} ms", schema, System.currentTimeMillis() - start);
                } catch (SQLException e) {
                    log.warn("Failed to list tables in schema [{}]: {}", schema, e.getMessage());
                }
            }
        }
        return tables;
    }

    @Override
    public List<LightSchema.ColumnInfo> getColumns(String tableName) throws SQLException {
        List<LightSchema.ColumnInfo> columns = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            String schema = resolveSchemaFor(tableName, conn);
            String bare = bareTable(tableName);
            try (ResultSet rs = conn.getMetaData().getColumns(
                    conn.getCatalog(), schema, bare, "%")) {
                while (rs.next()) {
                    columns.add(LightSchema.ColumnInfo.builder()
                            .name(rs.getString("COLUMN_NAME"))
                            .type(rs.getString("TYPE_NAME"))
                            .nullable(rs.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls)
                            .description(rs.getString("REMARKS"))
                            .build());
                }
            }
        }
        return columns;
    }

    @Override
    public List<String> getPrimaryKeys(String tableName) throws SQLException {
        List<String> keys = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            String schema = resolveSchemaFor(tableName, conn);
            String bare = bareTable(tableName);
            try (ResultSet rs = conn.getMetaData().getPrimaryKeys(
                    conn.getCatalog(), schema, bare)) {
                while (rs.next()) {
                    keys.add(rs.getString("COLUMN_NAME"));
                }
            }
        }
        return keys;
    }

    @Override
    public List<LightSchema.ForeignKey> getForeignKeys(String tableName) throws SQLException {
        List<LightSchema.ForeignKey> fks = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            String schema = resolveSchemaFor(tableName, conn);
            String bare = bareTable(tableName);
            try (ResultSet rs = conn.getMetaData().getImportedKeys(
                    conn.getCatalog(), schema, bare)) {
                while (rs.next()) {
                    String pkSchema = rs.getString("PKTABLE_SCHEM");
                    String pkTable = rs.getString("PKTABLE_NAME");
                    // 跨 schema 时把被引用表也限定，便于下游正确解析
                    String referencedTable = (qualifyTableNames(resolveSchemas())
                            && pkSchema != null && !pkSchema.isBlank())
                            ? pkSchema + "." + pkTable
                            : pkTable;
                    fks.add(LightSchema.ForeignKey.builder()
                            .columnName(rs.getString("FKCOLUMN_NAME"))
                            .referencedTable(referencedTable)
                            .referencedColumn(rs.getString("PKCOLUMN_NAME"))
                            .build());
                }
            }
        }
        return fks;
    }

    @Override
    public String getTableDescription(String tableName) throws SQLException {
        try (Connection conn = dataSource.getConnection()) {
            String schema = resolveSchemaFor(tableName, conn);
            String bare = bareTable(tableName);
            try (ResultSet rs = conn.getMetaData().getTables(
                    conn.getCatalog(), schema, bare, new String[] { "TABLE", "VIEW" })) {
                if (rs.next()) {
                    String remarks = rs.getString("REMARKS");
                    return remarks == null ? "" : remarks;
                }
            }
        }
        return "";
    }

    @Override
    public List<String> getIndices(String tableName) throws SQLException {
        List<String> indices = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            String schema = resolveSchemaFor(tableName, conn);
            String bare = bareTable(tableName);
            try (ResultSet rs = conn.getMetaData().getIndexInfo(
                    conn.getCatalog(), schema, bare, false, false)) {
                while (rs.next()) {
                    String indexName = rs.getString("INDEX_NAME");
                    if (indexName != null) {
                        indices.add(indexName);
                    }
                }
            }
        }
        return indices.stream().distinct().collect(Collectors.toList());
    }

    @Override
    public List<String> getSampleValues(String tableName, String columnName, int limit) throws SQLException {
        int effectiveLimit = Math.min(limit, MAX_SAMPLE_LIMIT);
        String quotedTable = quoteQualifiedTable(tableName);
        String quotedColumn = quoteIdentifier(columnName);
        String sql = String.format("SELECT DISTINCT %s FROM %s %s",
                quotedColumn, quotedTable, limitClause(effectiveLimit));
        List<String> samples = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(sql);
                ResultSet rs = stmt.executeQuery()) {
            while (rs.next()) {
                Object val = rs.getObject(1);
                if (val != null) {
                    samples.add(val.toString());
                }
            }
        } catch (Exception e) {
            log.warn("Failed to get sample values for {}.{}: {}", tableName, columnName, e.getMessage());
        }
        return samples;
    }

    // -------------------------------- identifier quoting --------------------------------

    /** PG 标准：双引号包裹，内部双引号转义。 */
    @Override
    protected String quoteIdentifier(String identifier) {
        if (identifier == null) {
            return "\"\"";
        }
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }

    /** 把 "schema.table" 或 "table" 拼成 "\"schema\".\"table\"" / "\"table\""。 */
    private String quoteQualifiedTable(String tableName) {
        String[] parts = splitQualified(tableName);
        if (parts[0] != null) {
            return quoteIdentifier(parts[0]) + "." + quoteIdentifier(parts[1]);
        }
        return quoteIdentifier(parts[1]);
    }

    @Override
    protected String getDropTableSqlIfExists(String tableName) {
        return String.format("DROP TABLE IF EXISTS %s CASCADE", quoteQualifiedTable(tableName));
    }

    @Override
    public String limitClause(int limit) {
        return "LIMIT " + limit;
    }

    @Override
    protected String stringDataType() {
        return "TEXT";
    }

    // -------------------------------- type handling --------------------------------

    @Override
    protected Object handleSpecificTypes(Object value, int columnType) {
        if (value == null) {
            return null;
        }
        switch (columnType) {
            case Types.BIT:
            case Types.BOOLEAN:
                if (value instanceof Boolean) {
                    return value;
                } else if (value instanceof String str) {
                    return "t".equalsIgnoreCase(str) || "true".equalsIgnoreCase(str) || "1".equals(str);
                } else if (value instanceof Number num) {
                    return num.intValue() != 0;
                }
                break;
            case Types.SMALLINT:
                if (value instanceof Number num) {
                    return num.shortValue();
                }
                break;
            case Types.INTEGER:
                if (value instanceof Number num) {
                    return num.intValue();
                }
                break;
            case Types.BIGINT:
                if (value instanceof Number num) {
                    return num.longValue();
                }
                break;
            case Types.REAL:
                if (value instanceof Number num) {
                    return num.floatValue();
                }
                break;
            case Types.DOUBLE:
            case Types.FLOAT:
                if (value instanceof Number num) {
                    return num.doubleValue();
                }
                break;
            case Types.NUMERIC:
            case Types.DECIMAL:
                if (value instanceof java.math.BigDecimal bd) {
                    return bd;
                }
                break;
            case Types.CHAR:
                if (value instanceof String str) {
                    return str.trim();
                }
                break;
            case Types.VARCHAR:
            case Types.LONGVARCHAR:
                if (value instanceof String) {
                    return value;
                }
                break;
            case Types.BINARY:
            case Types.VARBINARY:
            case Types.LONGVARBINARY:
                if (value instanceof byte[]) {
                    return value;
                }
                break;
            case Types.DATE:
                // 转为LocalDate，避免java.sql.Date被Jackson按UTC渲染导致日期偏移
                if (value instanceof LocalDate) {
                    return value;
                }
                if (value instanceof Date date) {
                    return date.toLocalDate();
                }
                break;
            case Types.TIME:
            case Types.TIME_WITH_TIMEZONE:
                if (value instanceof LocalTime) {
                    return value;
                }
                if (value instanceof Time time) {
                    return time.toLocalTime();
                }
                break;
            case Types.TIMESTAMP:
            case Types.TIMESTAMP_WITH_TIMEZONE:
                // 转为LocalDateTime斩断时区：timestamp本身无时区概念，
                // 而java.sql.Timestamp是按JVM默认时区换算的epoch，
                // 直接进入Jackson会被按UTC渲染（如2026-05-31 00:00:00变成2026-05-30T16:00:00Z）
                if (value instanceof LocalDateTime) {
                    return value;
                }
                if (value instanceof Timestamp ts) {
                    return ts.toLocalDateTime();
                }
                break;
            case Types.ARRAY:
                if (value instanceof Array array) {
                    try {
                        return array.getArray();
                    } catch (Exception e) {
                        return value.toString();
                    }
                }
                break;
            case Types.OTHER:
                if (value instanceof PGobject pgObject) {
                    String type = pgObject.getType();
                    String stringValue = pgObject.getValue();
                    switch (type.toLowerCase()) {
                        case "json":
                        case "jsonb":
                        case "uuid":
                        case "point":
                        case "line":
                        case "lseg":
                        case "box":
                        case "path":
                        case "polygon":
                        case "circle":
                        case "inet":
                        case "cidr":
                        case "macaddr":
                        case "macaddr8":
                        case "interval":
                        case "bit":
                        case "varbit":
                        case "tsvector":
                        case "tsquery":
                            return stringValue;
                        case "money":
                            try {
                                String cleanValue = stringValue.replaceAll("[^0-9.-]", "");
                                return new java.math.BigDecimal(cleanValue);
                            } catch (NumberFormatException e) {
                                return stringValue;
                            }
                        default:
                            return stringValue;
                    }
                }
                break;
        }
        return value;
    }

    @Override
    public AnsiSqlType toAnsiSqlType(int columnType, String columnTypeName, int precision, int scale) {
        return switch (columnTypeName.toLowerCase()) {
            case "int2", "smallint", "smallserial" -> AnsiSqlType.SMALLINT;
            case "int4", "int", "integer", "serial" -> AnsiSqlType.INTEGER;
            case "int8", "bigint", "bigserial" -> AnsiSqlType.BIGINT;
            case "float4", "real" -> AnsiSqlType.REAL;
            case "float8", "double precision", "float" -> AnsiSqlType.DOUBLE;
            case "numeric", "decimal", "money" -> AnsiSqlType.DECIMAL;
            case "bpchar", "char" -> AnsiSqlType.CHAR;
            case "varchar", "character varying" -> AnsiSqlType.VARCHAR;
            case "text" -> AnsiSqlType.TEXT;
            case "bytea" -> AnsiSqlType.VARBINARY;
            case "bool", "boolean" -> AnsiSqlType.BOOLEAN;
            case "date" -> AnsiSqlType.DATE;
            case "time", "time without time zone",
                 "timetz", "time with time zone" -> AnsiSqlType.TIME;
            case "timestamp", "timestamp without time zone",
                 "timestamptz", "timestamp with time zone" -> AnsiSqlType.TIMESTAMP;
            case "interval", "uuid",
                 "inet", "cidr", "macaddr", "macaddr8" -> AnsiSqlType.VARCHAR;
            case "json", "jsonb", "xml",
                 "point", "line", "lseg", "box", "path", "polygon", "circle",
                 "tsvector", "tsquery",
                 "_int2", "_int4", "_int8", "_float4", "_float8", "_text", "_varchar" -> AnsiSqlType.TEXT;
            case "bit", "varbit" -> AnsiSqlType.VARBINARY;
            default -> super.toAnsiSqlType(columnType, columnTypeName, precision, scale);
        };
    }

    @Override
    protected int toColumnType(String dataType) {
        if (dataType == null) {
            return Types.VARCHAR;
        }
        return switch (extractBaseType(dataType).toLowerCase()) {
            case "smallint", "int2" -> Types.SMALLINT;
            case "integer", "int", "int4", "serial", "serial4" -> Types.INTEGER;
            case "bigint", "int8", "bigserial", "serial8" -> Types.BIGINT;
            case "real", "float4" -> Types.REAL;
            case "double precision", "float8" -> Types.DOUBLE;
            case "numeric", "decimal", "money" -> Types.NUMERIC;
            case "boolean", "bool" -> Types.BOOLEAN;
            case "char", "\"char\"", "character", "bpchar" -> Types.CHAR;
            case "varchar", "character varying" -> Types.VARCHAR;
            case "text", "json", "jsonb", "xml",
                 "point", "line", "lseg", "box", "path", "polygon", "circle",
                 "tsvector", "tsquery",
                 "_int2", "_int4", "_int8", "_float4", "_float8", "_text", "_varchar" -> Types.LONGVARCHAR;
            case "date" -> Types.DATE;
            case "time", "time without time zone",
                 "timetz", "time with time zone" -> Types.TIME;
            case "timestamp", "timestamp without time zone",
                 "timestamptz", "timestamp with time zone" -> Types.TIMESTAMP;
            case "interval", "uuid",
                 "inet", "cidr", "macaddr", "macaddr8" -> Types.VARCHAR;
            case "bytea", "varbit", "bit varying" -> Types.VARBINARY;
            case "bit" -> Types.BIT;
            default -> Types.VARCHAR;
        };
    }

    private String extractBaseType(String dataType) {
        int parenIndex = dataType.indexOf('(');
        if (parenIndex == -1) {
            return dataType;
        }
        return dataType.substring(0, parenIndex).trim();
    }
}

