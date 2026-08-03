package ai.dat.server.openapi.service;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.LightSchema;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.sql.SQLException;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 数据库单元格向量化服务
 * 遍历数据库中的枚举值并将其存入向量库，用于后续的字面量模糊匹配
 *
 * @Author DAT Team
 * @Date 2026/1/5
 */
@Slf4j
@Service
public class CellVectorizationService {

    /**
     * 对指定数据源的所有列进行单元格向量化（向后兼容）。
     */
    public void vectorize(DatabaseAdapter adapter, ContentStore contentStore, int rowLimit) {
        vectorize(adapter, contentStore, rowLimit, null);
    }

    /**
     * 对指定数据源的部分（或全部）表的列进行单元格向量化。
     *
     * @param adapter        数据库适配器
     * @param contentStore   内容存储器
     * @param rowLimit       采样行数
     * @param selectedTables 要向量化的表名集合；为 null 或空时，向量化所有表。
     */
    public void vectorize(DatabaseAdapter adapter, ContentStore contentStore, int rowLimit,
                          Collection<String> selectedTables) {
        try {
            List<String> tableNames = adapter.getTableNames();
            Set<String> filter = selectedTables == null || selectedTables.isEmpty()
                    ? null : new HashSet<>(selectedTables);
            for (String tableName : tableNames) {
                if (filter != null && !filter.contains(tableName)) {
                    continue;
                }
                vectorizeTable(adapter, contentStore, tableName, rowLimit);
            }
        } catch (SQLException e) {
            log.error("Failed to get table names for cell vectorization: {}", e.getMessage());
        }
    }

    /**
     * 对单张表的列进行单元格向量化
     */
    public void vectorizeTable(DatabaseAdapter adapter, ContentStore contentStore, String tableName, int rowLimit) {
        try {
            List<LightSchema.ColumnInfo> columns = adapter.getColumns(tableName);
            for (LightSchema.ColumnInfo col : columns) {
                // 通常只对字符串类型的列进行向量化
                if (isVectorizableType(col.getType())) {
                    log.info("Vectorizing cells for {}.{}", tableName, col.getName());
                    try {
                        List<String> values = adapter.getSampleValues(tableName, col.getName(), rowLimit);
                        if (!values.isEmpty()) {
                            contentStore.addCells(tableName, col.getName(), values);
                        }
                    } catch (Exception e) {
                        log.warn("Failed to vectorize cells for {}.{}: {}", tableName, col.getName(), e.getMessage());
                    }
                }
            }
        } catch (SQLException e) {
            log.error("Failed to get columns for table {}: {}", tableName, e.getMessage());
        }
    }

    /**
     * 判断列类型是否适合向量化（主要是文本类）
     */
    private boolean isVectorizableType(String typeName) {
        if (typeName == null) return false;
        String type = typeName.toUpperCase();
        return type.contains("CHAR") || type.contains("TEXT") || type.contains("STRING") || type.contains("ENUM");
    }
}
