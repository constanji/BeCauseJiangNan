package ai.dat.project.datastore.repository;

import ai.dat.project.datastore.document.GlobalConfigDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

/**
 * 全局配置存储库
 *
 * @Author DAT Team
 * @Date 2026/06/16
 */
@Repository
public interface GlobalConfigRepository extends MongoRepository<GlobalConfigDocument, String> {
}
