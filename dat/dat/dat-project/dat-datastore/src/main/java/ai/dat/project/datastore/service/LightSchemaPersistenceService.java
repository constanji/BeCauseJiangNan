package ai.dat.project.datastore.service;

import ai.dat.core.contentstore.data.LightSchema;
import ai.dat.project.datastore.document.LightSchemaDocument;
import ai.dat.project.datastore.repository.LightSchemaRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Light Schema 存储服务
 *
 * @Author DAT Team
 * @Date 2026/1/7
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LightSchemaPersistenceService {

    private final LightSchemaRepository lightSchemaRepository;

    /**
     * 保存 Light Schemas（整体覆盖该 datasource 下所有数据）。
     * 注意：会先删除该 datasource 的全部 schema，仅用于"全量重建"场景。
     * 增量更新请使用 {@link #saveLightSchemasIncremental}。
     */
    public void saveLightSchemas(String projectId, String datasourceId, List<LightSchema> schemas) {
        log.info("Saving {} light schemas (full overwrite) to MongoDB for project: {}, datasource: {}",
                schemas.size(), projectId, datasourceId);

        lightSchemaRepository.deleteByProjectIdAndDatasourceId(projectId, datasourceId);

        List<LightSchemaDocument> docs = schemas.stream()
                .map(schema -> LightSchemaDocument.builder()
                        .projectId(projectId)
                        .datasourceId(datasourceId)
                        .tableName(schema.getTableName())
                        .schema(schema)
                        .build())
                .collect(Collectors.toList());

        lightSchemaRepository.saveAll(docs);
    }

    /**
     * 按表名增量保存 Light Schemas：
     * 已存在 (projectId, datasourceId, tableName) 的记录会被覆盖（保留原 _id），
     * 不在 schemas 列表中的其他表不受影响。
     */
    public void saveLightSchemasIncremental(String projectId, String datasourceId, List<LightSchema> schemas) {
        if (schemas == null || schemas.isEmpty()) {
            return;
        }
        log.info("Saving {} light schemas (incremental) to MongoDB for project: {}, datasource: {}",
                schemas.size(), projectId, datasourceId);

        List<String> incomingTableNames = schemas.stream()
                .map(LightSchema::getTableName)
                .collect(Collectors.toList());

        Map<String, LightSchemaDocument> existingByTable = new HashMap<>();
        for (LightSchemaDocument doc : lightSchemaRepository
                .findByProjectIdAndDatasourceIdAndTableNameIn(projectId, datasourceId, incomingTableNames)) {
            existingByTable.put(doc.getTableName(), doc);
        }

        List<LightSchemaDocument> toSave = schemas.stream()
                .map(schema -> {
                    LightSchemaDocument existing = existingByTable.get(schema.getTableName());
                    return LightSchemaDocument.builder()
                            .id(existing != null ? existing.getId() : null)
                            .projectId(projectId)
                            .datasourceId(datasourceId)
                            .tableName(schema.getTableName())
                            .schema(schema)
                            .build();
                })
                .collect(Collectors.toList());

        lightSchemaRepository.saveAll(toSave);
    }

    /**
     * 获取指定数据源的所有 Light Schemas
     */
    public List<LightSchema> getLightSchemas(String projectId, String datasourceId) {
        return lightSchemaRepository.findByProjectIdAndDatasourceId(projectId, datasourceId).stream()
                .map(LightSchemaDocument::getSchema)
                .collect(Collectors.toList());
    }

    /**
     * 获取指定数据源、指定表名集合的 Light Schemas
     */
    public List<LightSchema> getLightSchemas(String projectId, String datasourceId, Collection<String> tableNames) {
        if (tableNames == null || tableNames.isEmpty()) {
            return java.util.Collections.emptyList();
        }
        return lightSchemaRepository
                .findByProjectIdAndDatasourceIdAndTableNameIn(projectId, datasourceId, tableNames)
                .stream()
                .map(LightSchemaDocument::getSchema)
                .collect(Collectors.toList());
    }

    /**
     * 删除指定数据源的所有 Light Schemas
     */
    public void removeLightSchemas(String projectId, String datasourceId) {
        lightSchemaRepository.deleteByProjectIdAndDatasourceId(projectId, datasourceId);
    }

    /**
     * 按表名集合删除该 datasource 下的 Light Schemas（增量清理）。
     */
    public void removeLightSchemasByTables(String projectId, String datasourceId, Collection<String> tableNames) {
        if (tableNames == null || tableNames.isEmpty()) {
            return;
        }
        lightSchemaRepository.deleteByProjectIdAndDatasourceIdAndTableNameIn(projectId, datasourceId, tableNames);
    }
}
