package ai.dat.project.datastore.repository;

import ai.dat.project.datastore.document.ProjectDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/**
 * 项目 Repository 接口
 * 
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Repository
public interface ProjectRepository extends MongoRepository<ProjectDocument, String> {

    /**
     * 根据项目名称查找项目
     * 
     * @param name 项目名称
     * @return 项目文档
     */
    Optional<ProjectDocument> findByName(String name);

    /**
     * 检查项目名称是否存在
     * 
     * @param name 项目名称
     * @return 是否存在
     */
    boolean existsByName(String name);

}
