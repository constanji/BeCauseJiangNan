package ai.dat.project.datastore.repository;

import ai.dat.project.datastore.document.OrgNodeDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 机构节点 Repository。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Repository
public interface OrgNodeRepository extends MongoRepository<OrgNodeDocument, String> {

    List<OrgNodeDocument> findByProjectId(String projectId);

    void deleteByProjectId(String projectId);

    /** 按项目 + 数据日期查询机构节点。 */
    List<OrgNodeDocument> findByProjectIdAndDataDt(String projectId, String dataDt);

    /** 按项目 + 数据日期删除机构节点（替换快照用）。 */
    void deleteByProjectIdAndDataDt(String projectId, String dataDt);

    /** 按项目查所有机构节点，按 dataDt 降序排列。用于手动提取 distinct dataDt。 */
    List<OrgNodeDocument> findByProjectIdOrderByDataDtDesc(String projectId);

    /** 按项目 + 数据日期 + 机构编码定位单节点（inline 编辑数据权限用）。 */
    Optional<OrgNodeDocument> findByProjectIdAndDataDtAndOrgCode(String projectId, String dataDt, String orgCode);
}
