package ai.dat.server.openapi.service;

import ai.dat.core.adapter.DatabaseAdapter;
import ai.dat.core.contentstore.data.LightSchema;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Light Schema 生成服务
 * 从数据库适配器中提取元数据并生成 Light Schema
 *
 * @Author DAT Team
 * @Date 2026/1/5
 */
@Slf4j
@Service
public class LightSchemaGenerator {

    /**
     * 为指定数据源的所有表生成 Light Schema（向后兼容）。
     */
    public List<LightSchema> generate(DatabaseAdapter adapter, int sampleLimit) {
        return generate(adapter, sampleLimit, null);
    }

    /**
     * 为指定数据源的部分（或全部）表生成 Light Schema。
     *
     * @param adapter           数据库适配器
     * @param sampleLimit       采样行数
     * @param selectedTables    要生成的表名集合；为 null 或空时，生成数据源下所有表（全量）。
     *                          未在数据库中实际存在的表名会被忽略。
     */
    public List<LightSchema> generate(DatabaseAdapter adapter, int sampleLimit, Collection<String> selectedTables) {
        List<LightSchema> schemas = new ArrayList<>();
        try {
            List<String> allTableNames = adapter.getTableNames();
            List<String> tableNames;
            if (selectedTables == null || selectedTables.isEmpty()) {
                tableNames = allTableNames;
            } else {
                Set<String> selected = new HashSet<>(selectedTables);
                tableNames = new ArrayList<>();
                for (String t : allTableNames) {
                    if (selected.contains(t)) {
                        tableNames.add(t);
                    }
                }
                if (tableNames.size() != selected.size()) {
                    Set<String> existing = new HashSet<>(tableNames);
                    selected.removeAll(existing);
                    log.warn("Requested tables not found in datasource, ignored: {}", selected);
                }
            }
            for (String tableName : tableNames) {
                try {
                    LightSchema schema = generateForTable(adapter, tableName, sampleLimit);
                    schemas.add(schema);
                } catch (Exception e) {
                    log.error("Failed to generate Light Schema for table {}: {}", tableName, e.getMessage());
                }
            }
        } catch (SQLException e) {
            log.error("Failed to get table names from adapter: {}", e.getMessage());
        }
        return schemas;
    }

    /**
     * 为单张表生成 Light Schema
     */
    public LightSchema generateForTable(DatabaseAdapter adapter, String tableName, int sampleLimit) throws SQLException {
        List<LightSchema.ColumnInfo> columns = adapter.getColumns(tableName);
        List<String> primaryKeys = adapter.getPrimaryKeys(tableName);
        List<LightSchema.ForeignKey> foreignKeys = adapter.getForeignKeys(tableName);
        String tableDescription = adapter.getTableDescription(tableName);
        List<String> indices = adapter.getIndices(tableName);

        // 获取采样值
        for (LightSchema.ColumnInfo col : columns) {
            try {
                List<String> samples = adapter.getSampleValues(tableName, col.getName(), sampleLimit);
                col.setSampleValues(samples);
            } catch (Exception e) {
                log.warn("Failed to get samples for {}.{}: {}", tableName, col.getName(), e.getMessage());
            }
        }

        return LightSchema.builder()
                .tableName(tableName)
                .tableDescription(tableDescription)
                .columns(columns)
                .primaryKeys(primaryKeys)
                .foreignKeys(foreignKeys)
                .indices(indices)
                .build();
    }
}
