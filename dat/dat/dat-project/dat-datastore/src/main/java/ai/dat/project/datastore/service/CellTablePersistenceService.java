package ai.dat.project.datastore.service;

import ai.dat.project.datastore.document.CellTableDocument;
import ai.dat.project.datastore.repository.CellTableRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 单元格向量化跟踪服务。
 * 给前端"已向量化"状态提供 O(1) 查询，避免对向量库做全表扫。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CellTablePersistenceService {

    private final CellTableRepository cellTableRepository;

    /**
     * 标记一组表已完成向量化。已存在记录会被覆盖（更新 vectorizedAt）。
     */
    public void markVectorized(String projectId, String datasourceId, Collection<String> tableNames) {
        if (tableNames == null || tableNames.isEmpty()) {
            return;
        }
        Instant now = Instant.now();

        Map<String, CellTableDocument> existingByTable = new HashMap<>();
        for (CellTableDocument doc : cellTableRepository.findByProjectIdAndDatasourceId(projectId, datasourceId)) {
            existingByTable.put(doc.getTableName(), doc);
        }

        List<CellTableDocument> toSave = tableNames.stream()
                .distinct()
                .map(t -> {
                    CellTableDocument existing = existingByTable.get(t);
                    return CellTableDocument.builder()
                            .id(existing != null ? existing.getId() : null)
                            .projectId(projectId)
                            .datasourceId(datasourceId)
                            .tableName(t)
                            .vectorizedAt(now)
                            .build();
                })
                .collect(Collectors.toList());

        cellTableRepository.saveAll(toSave);
    }

    /**
     * 列出该 datasource 下所有已向量化的表名。
     */
    public Set<String> listVectorizedTables(String projectId, String datasourceId) {
        return cellTableRepository.findByProjectIdAndDatasourceId(projectId, datasourceId).stream()
                .map(CellTableDocument::getTableName)
                .collect(Collectors.toCollection(HashSet::new));
    }

    /**
     * 清空该 datasource 下所有"已向量化"标记。
     */
    public void removeAll(String projectId, String datasourceId) {
        cellTableRepository.deleteByProjectIdAndDatasourceId(projectId, datasourceId);
    }

    /**
     * 删除指定 datasource 下、指定表名集合的"已向量化"标记。
     */
    public void removeByTables(String projectId, String datasourceId, Collection<String> tableNames) {
        if (tableNames == null || tableNames.isEmpty()) {
            return;
        }
        cellTableRepository.deleteByProjectIdAndDatasourceIdAndTableNameIn(projectId, datasourceId, tableNames);
    }
}
