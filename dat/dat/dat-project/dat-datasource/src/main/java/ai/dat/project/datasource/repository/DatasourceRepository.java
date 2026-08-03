package ai.dat.project.datasource.repository;

import ai.dat.project.datasource.document.DatasourceDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 数据源 Repository 接口
 * 
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Repository
public interface DatasourceRepository extends MongoRepository<DatasourceDocument, String> {

    /**
     * 根据项目ID查询所有数据源
     * 
     * @param projectId 项目ID
     * @return 数据源列表
     */
    List<DatasourceDocument> findByProjectId(String projectId);

    /**
     * 根据项目ID和数据源名称查找数据源
     * 
     * @param projectId 项目ID
     * @param name 数据源名称
     * @return 数据源文档
     */
    Optional<DatasourceDocument> findByProjectIdAndName(String projectId, String name);

    /**
     * 检查项目下是否存在指定名称的数据源
     * 
     * @param projectId 项目ID
     * @param name 数据源名称
     * @return 是否存在
     */
    boolean existsByProjectIdAndName(String projectId, String name);

    /**
     * 根据项目ID查询启用的数据源
     * 
     * @param projectId 项目ID
     * @return 启用的数据源列表
     */
    List<DatasourceDocument> findByProjectIdAndEnabledTrue(String projectId);

    /**
     * 删除项目下所有数据源
     * 
     * @param projectId 项目ID
     */
    void deleteByProjectId(String projectId);

}
