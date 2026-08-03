package ai.dat.project.datastore.repository;

import ai.dat.project.datastore.document.CellTableDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface CellTableRepository extends MongoRepository<CellTableDocument, String> {

    List<CellTableDocument> findByProjectIdAndDatasourceId(String projectId, String datasourceId);

    Optional<CellTableDocument> findByProjectIdAndDatasourceIdAndTableName(String projectId,
                                                                          String datasourceId,
                                                                          String tableName);

    void deleteByProjectIdAndDatasourceId(String projectId, String datasourceId);

    void deleteByProjectIdAndDatasourceIdAndTableNameIn(String projectId,
                                                       String datasourceId,
                                                       Collection<String> tableNames);
}
