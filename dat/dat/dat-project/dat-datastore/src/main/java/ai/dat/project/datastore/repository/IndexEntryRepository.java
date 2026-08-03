package ai.dat.project.datastore.repository;

import ai.dat.project.datastore.document.IndexEntryDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;

/**
 * 指标库 Repository。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Repository
public interface IndexEntryRepository extends MongoRepository<IndexEntryDocument, String> {

    List<IndexEntryDocument> findByProjectId(String projectId);

    List<IndexEntryDocument> findByProjectIdAndIndexNumberIn(String projectId,
                                                              Collection<String> indexNumbers);

    long countByProjectId(String projectId);

    void deleteByProjectId(String projectId);

    void deleteByProjectIdAndIndexNumberIn(String projectId, Collection<String> indexNumbers);
}
