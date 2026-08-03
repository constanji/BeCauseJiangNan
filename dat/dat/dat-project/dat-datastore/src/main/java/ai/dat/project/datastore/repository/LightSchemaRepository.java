package ai.dat.project.datastore.repository;

import ai.dat.project.datastore.document.LightSchemaDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Light Schema Repository
 *
 * @Author DAT Team
 * @Date 2026/1/7
 */
@Repository
public interface LightSchemaRepository extends MongoRepository<LightSchemaDocument, String> {

    List<LightSchemaDocument> findByProjectIdAndDatasourceId(String projectId, String datasourceId);

    Optional<LightSchemaDocument> findByProjectIdAndDatasourceIdAndTableName(String projectId, String datasourceId, String tableName);

    List<LightSchemaDocument> findByProjectIdAndDatasourceIdAndTableNameIn(String projectId, String datasourceId, Collection<String> tableNames);

    void deleteByProjectIdAndDatasourceId(String projectId, String datasourceId);

    void deleteByProjectIdAndDatasourceIdAndTableNameIn(String projectId, String datasourceId, Collection<String> tableNames);
}
