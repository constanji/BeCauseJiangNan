package ai.dat.core.adapter;

import ai.dat.core.adapter.data.AnsiSqlType;
import ai.dat.core.adapter.data.Column;
import ai.dat.core.adapter.data.ColumnMetadata;
import ai.dat.core.adapter.data.Table;
import ai.dat.core.contentstore.data.LightSchema;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.sql.*;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * @Author JunjieM
 * @Date 2025/7/2
 */
@Slf4j
public abstract class GenericSqlDatabaseAdapter implements DatabaseAdapter {

    protected final DataSource dataSource;

    public GenericSqlDatabaseAdapter(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public abstract String getDialect();

    // -------------------------------------- execution
    // ------------------------------------------

    @Override
    public List<Map<String, Object>> executeQuery(String sql) throws SQLException {
        List<Map<String, Object>> results = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(sql);
                ResultSet rs = stmt.executeQuery()) {
            ResultSetMetaData md = rs.getMetaData();
            int columnCount = md.getColumnCount();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int i = 1; i <= columnCount; i++) {
                    String columnName = md.getColumnLabel(i);
                    Object value = rs.getObject(i);
                    value = handleSpecificTypes(value, md.getColumnType(i));
                    row.put(columnName, value);
                }
                results.add(row);
            }
        }
        return results;
    }

    protected abstract Object handleSpecificTypes(Object value, int columnType);

    @Override
    public List<ColumnMetadata> getColumnMetadata(String sql) throws SQLException {
        List<ColumnMetadata> columns = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(sql);
                ResultSet rs = stmt.executeQuery()) {
            ResultSetMetaData metaData = rs.getMetaData();
            int columnCount = metaData.getColumnCount();
            for (int i = 1; i <= columnCount; i++) {
                String columnName = metaData.getColumnName(i);
                String columnLabel = metaData.getColumnLabel(i);
                int columnType = metaData.getColumnType(i);
                String columnTypeName = metaData.getColumnTypeName(i);
                int precision = metaData.getPrecision(i);
                int scale = metaData.getScale(i);
                boolean nullable = metaData.isNullable(i) != ResultSetMetaData.columnNoNulls;
                boolean autoIncrement = metaData.isAutoIncrement(i);
                int displaySize = metaData.getColumnDisplaySize(i);
                AnsiSqlType ansiSqlType = toAnsiSqlType(columnType, columnTypeName, precision, scale);
                ColumnMetadata column = ColumnMetadata.builder()
                        .columnName(columnName)
                        .columnLabel(columnLabel)
                        .columnType(columnType)
                        .columnTypeName(columnTypeName)
                        .ansiSqlType(ansiSqlType)
                        .precision(precision)
                        .scale(scale)
                        .nullable(nullable)
                        .autoIncrement(autoIncrement)
                        .displaySize(displaySize)
                        .columnIndex(i)
                        .build();
                columns.add(column);
            }
        }
        return columns;
    }

    // -------------------------------------- metadata
    // ------------------------------------------

    @Override
    public List<String> getTableNames() throws SQLException {
        List<String> tables = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getTables(conn.getCatalog(), conn.getSchema(), "%",
                    new String[] { "TABLE" })) {
                while (rs.next()) {
                    tables.add(rs.getString("TABLE_NAME"));
                }
            }
        }
        return tables;
    }

    @Override
    public List<String> getTableNames(String schema) throws SQLException {
        if (schema == null) {
            return getTableNames();
        }
        List<String> tables = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getTables(conn.getCatalog(), schema, "%",
                    new String[] { "TABLE" })) {
                while (rs.next()) {
                    tables.add(rs.getString("TABLE_NAME"));
                }
            }
        }
        return tables;
    }

    @Override
    public List<String> getSchemas() throws SQLException {
        List<String> schemas = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getSchemas()) {
                while (rs.next()) {
                    String name = rs.getString("TABLE_SCHEM");
                    if (name != null && !name.isBlank()) {
                        schemas.add(name);
                    }
                }
            }
            if (schemas.isEmpty()) {
                String current = conn.getSchema();
                if (current != null && !current.isBlank()) {
                    schemas.add(current);
                }
            }
        }
        return schemas;
    }

    @Override
    public List<LightSchema.ColumnInfo> getColumns(String tableName) throws SQLException {
        List<LightSchema.ColumnInfo> columns = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getColumns(conn.getCatalog(), conn.getSchema(), tableName, "%")) {
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
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getPrimaryKeys(conn.getCatalog(), conn.getSchema(), tableName)) {
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
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getImportedKeys(conn.getCatalog(), conn.getSchema(), tableName)) {
                while (rs.next()) {
                    fks.add(LightSchema.ForeignKey.builder()
                            .columnName(rs.getString("FKCOLUMN_NAME"))
                            .referencedTable(rs.getString("PKTABLE_NAME"))
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
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getTables(conn.getCatalog(), conn.getSchema(), tableName,
                    new String[] { "TABLE", "VIEW" })) {
                if (rs.next()) {
                    return rs.getString("REMARKS");
                }
            }
        }
        return "";
    }

    @Override
    public List<String> getIndices(String tableName) throws SQLException {
        List<String> indices = new ArrayList<>();
        try (Connection conn = dataSource.getConnection()) {
            DatabaseMetaData metaData = conn.getMetaData();
            try (ResultSet rs = metaData.getIndexInfo(conn.getCatalog(), conn.getSchema(), tableName, false, false)) {
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
        // Quote identifiers to handle reserved keywords like 'order'
        String quotedTable = quoteIdentifier(tableName);
        String quotedColumn = quoteIdentifier(columnName);
        String sql = String.format("SELECT DISTINCT %s FROM %s %s",
                quotedColumn, quotedTable, limitClause(limit));
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

    /**
     * Quote identifier to handle reserved keywords
     */
    protected String quoteIdentifier(String identifier) {
        return "`" + identifier + "`";
    }

    // -------------------------------------- seed
    // ------------------------------------------

    @Override
    public void initTable(Table table, List<List<String>> data) throws SQLException {
        String tableName = table.getName();
        try (Connection conn = dataSource.getConnection()) {
            dropTableIfExists(conn, tableName);
            createTable(conn, table);
            insertTable(conn, table, data);
        }
    }

    protected void dropTableIfExists(Connection conn, String tableName) {
        String sql = getDropTableSqlIfExists(tableName);
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
        } catch (SQLException e) {
            // 表不存在是正常情况，忽略异常
        }
    }

    protected void createTable(Connection conn, Table table) throws SQLException {
        String sql = getCreateTableSql(table);
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
        }
    }

    protected String getDropTableSqlIfExists(String tableName) {
        return String.format("DROP TABLE IF EXISTS %s", quoteIdentifier(tableName));
    }

    protected String getCreateTableSql(Table table) {
        StringBuilder sql = new StringBuilder();
        sql.append("CREATE TABLE ").append(quoteIdentifier(table.getName())).append(" (");
        List<Column> columns = table.getColumns();
        for (int i = 0; i < columns.size(); i++) {
            if (i > 0)
                sql.append(", ");
            Column column = columns.get(i);
            sql.append(quoteIdentifier(column.getName())).append(" ")
                    .append(getDataType(column.getType()));
        }
        sql.append(")");
        return sql.toString();
    }

    private String getDataType(String dataType) {
        return StringUtils.isBlank(dataType) ? stringDataType() : dataType;
    }

    protected String stringDataType() {
        return "TEXT";
    }

    protected void insertTable(Connection conn, Table table, List<List<String>> data) throws SQLException {
        if (data.isEmpty()) {
            return;
        }
        String sql = getInsertSql(table);
        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            int batchCount = 0;
            for (List<String> row : data) {
                setInsertParameters(stmt, row, table.getColumns());
                stmt.addBatch();
                batchCount++;
                // 每1000条提交一次批处理
                if (batchCount % 1000 == 0) {
                    stmt.executeBatch();
                    stmt.clearBatch();
                }
            }
            // 提交剩余的批处理
            if (batchCount % 1000 != 0) {
                stmt.executeBatch();
            }
        }
    }

    protected String getInsertSql(Table table) {
        StringBuilder sql = new StringBuilder();
        sql.append("INSERT INTO ").append(quoteIdentifier(table.getName())).append(" (");
        List<Column> columns = table.getColumns();
        for (int i = 0; i < columns.size(); i++) {
            if (i > 0)
                sql.append(", ");
            sql.append(quoteIdentifier(columns.get(i).getName()));
        }
        sql.append(") VALUES (");
        for (int i = 0; i < columns.size(); i++) {
            if (i > 0)
                sql.append(", ");
            sql.append("?");
        }
        sql.append(")");
        return sql.toString();
    }

    protected void setInsertParameters(PreparedStatement stmt, List<String> row, List<Column> columns)
            throws SQLException {
        for (int i = 0; i < columns.size() && i < row.size(); i++) {
            String value = row.get(i);
            Column column = columns.get(i);
            // 如果值为空或null字符串
            if (value == null || value.isEmpty()) {
                stmt.setNull(i + 1, toColumnType(column.getType()));
            } else {
                setParameterValue(stmt, i + 1, value, column.getType());
            }
        }
    }

    protected void setParameterValue(PreparedStatement stmt, int parameterIndex,
            String value, String dataType) throws SQLException {
        if (dataType == null) {
            stmt.setString(parameterIndex, value);
            return;
        }
        int columnType = toColumnType(dataType);
        if (Types.TINYINT == columnType) {
            stmt.setByte(parameterIndex, Byte.parseByte(value));
        } else if (Types.SMALLINT == columnType) {
            stmt.setShort(parameterIndex, Short.parseShort(value));
        } else if (Types.INTEGER == columnType) {
            stmt.setInt(parameterIndex, Integer.parseInt(value));
        } else if (Types.BIGINT == columnType) {
            stmt.setLong(parameterIndex, Long.parseLong(value));
        } else if (Types.DECIMAL == columnType || Types.NUMERIC == columnType) {
            stmt.setBigDecimal(parameterIndex, new BigDecimal(value));
        } else if (Types.FLOAT == columnType || Types.REAL == columnType) {
            stmt.setFloat(parameterIndex, Float.parseFloat(value));
        } else if (Types.DOUBLE == columnType) {
            stmt.setDouble(parameterIndex, Double.parseDouble(value));
        } else if (Types.BOOLEAN == columnType || Types.BIT == columnType) {
            stmt.setBoolean(parameterIndex, Boolean.parseBoolean(value));
        } else if (Types.DATE == columnType) {
            stmt.setDate(parameterIndex, Date.valueOf(value));
        } else if (Types.TIMESTAMP == columnType) {
            stmt.setTimestamp(parameterIndex, Timestamp.valueOf(value));
        } else if (Types.TIME == columnType) {
            stmt.setTime(parameterIndex, Time.valueOf(value));
        } else if (Types.BINARY == columnType || Types.VARBINARY == columnType || Types.LONGVARBINARY == columnType) {
            stmt.setBytes(parameterIndex, value.getBytes());
        } else if (Types.CHAR == columnType || Types.VARCHAR == columnType || Types.LONGVARCHAR == columnType) {
            stmt.setString(parameterIndex, value);
        } else if (Types.NCHAR == columnType || Types.NVARCHAR == columnType || Types.LONGNVARCHAR == columnType) {
            stmt.setNString(parameterIndex, value);
        } else if (Types.CLOB == columnType) {
            stmt.setClob(parameterIndex, new java.io.StringReader(value));
        } else if (Types.NCLOB == columnType) {
            stmt.setNClob(parameterIndex, new java.io.StringReader(value));
        } else if (Types.BLOB == columnType) {
            stmt.setBlob(parameterIndex, new java.io.ByteArrayInputStream(value.getBytes()));
        } else if (Types.ARRAY == columnType) {
            // 数组类型，暂时作为字符串处理
            stmt.setString(parameterIndex, value);
        } else if (Types.STRUCT == columnType) {
            // 结构体类型，使用setObject
            stmt.setObject(parameterIndex, value);
        } else if (Types.REF == columnType) {
            // 引用类型，暂时作为字符串处理
            stmt.setString(parameterIndex, value);
        } else if (Types.DATALINK == columnType) {
            try {
                stmt.setURL(parameterIndex, new java.net.URL(value));
            } catch (java.net.MalformedURLException e) {
                // URL格式错误时作为字符串处理
                stmt.setString(parameterIndex, value);
            }
        } else if (Types.SQLXML == columnType) {
            // XML类型，暂时作为字符串处理
            stmt.setString(parameterIndex, value);
        } else if (Types.ROWID == columnType) {
            // 行ID类型，暂时作为字符串处理
            stmt.setString(parameterIndex, value);
        } else if (Types.DISTINCT == columnType || Types.JAVA_OBJECT == columnType) {
            // 自定义类型和Java对象类型
            stmt.setObject(parameterIndex, value);
        } else if (Types.NULL == columnType) {
            // NULL类型
            stmt.setNull(parameterIndex, columnType);
        } else {
            // 默认作为字符串处理
            stmt.setString(parameterIndex, value);
        }
    }

    /**
     * 从数据类型映射到JDBC类型
     *
     * @param dataType
     * @return
     */
    protected abstract int toColumnType(String dataType);
}
