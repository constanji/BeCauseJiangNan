package ai.dat.core.adapter;

import ai.dat.core.adapter.data.AnsiSqlType;
import ai.dat.core.adapter.data.ColumnMetadata;
import ai.dat.core.adapter.data.Table;
import ai.dat.core.contentstore.data.LightSchema;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;

/**
 * 数据库适配器接口类
 *
 * @Author JunjieM
 * @Date 2025/6/25
 */
public interface DatabaseAdapter {
    // -------------------------------------- execution
    // ------------------------------------------

    List<Map<String, Object>> executeQuery(String sql) throws SQLException;

    List<ColumnMetadata> getColumnMetadata(String sql) throws SQLException;

    default AnsiSqlType toAnsiSqlType(int columnType, String columnTypeName, int precision, int scale) {
        return AnsiSqlType.fromColumnType(columnType);
    }

    String limitClause(int limit);

    /**
     * 获取数据库方言名称
     * 
     * @return 数据库方言名称，如 "MySQL", "PostgreSQL", "Oracle", "DuckDB"
     */
    String getDialect();

    // -------------------------------------- metadata
    // ------------------------------------------

    /**
     * 获取所有表名（向后兼容，可能跨所有 schema/database）。
     */
    List<String> getTableNames() throws SQLException;

    /**
     * 获取指定 schema / database 下的表名列表。
     * schema 为 null 时由各适配器决定行为（通常回退到默认 schema）。
     */
    List<String> getTableNames(String schema) throws SQLException;

    /**
     * 获取当前数据源下用户可见的 schema / database / namespace 列表。
     * 对于没有 schema 概念的数据源，可返回空列表或包含默认 schema 的单元素列表。
     */
    List<String> getSchemas() throws SQLException;

    /**
     * 获取指定表的列信息
     */
    List<LightSchema.ColumnInfo> getColumns(String tableName) throws SQLException;

    /**
     * 获取指定表的主键
     */
    List<String> getPrimaryKeys(String tableName) throws SQLException;

    /**
     * 获取指定表的外键关系
     */
    List<LightSchema.ForeignKey> getForeignKeys(String tableName) throws SQLException;

    /**
     * 获取指定列的采样值
     */
    List<String> getSampleValues(String tableName, String columnName, int limit) throws SQLException;

    /**
     * 获取指定表的描述
     */
    default String getTableDescription(String tableName) throws SQLException {
        return "";
    }

    /**
     * 获取指定表的索引信息
     */
    default List<String> getIndices(String tableName) throws SQLException {
        return List.of();
    }

    // -------------------------------------- seed
    // ------------------------------------------

    void initTable(Table table, List<List<String>> data) throws SQLException;

}
