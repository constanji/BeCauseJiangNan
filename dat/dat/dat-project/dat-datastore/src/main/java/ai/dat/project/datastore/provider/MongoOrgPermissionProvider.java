package ai.dat.project.datastore.provider;

import ai.dat.core.index.data.IndexContext;
import ai.dat.core.index.provider.OrgPermissionProvider;
import ai.dat.project.datastore.service.OrgDataPermissionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;

/**
 * 基于 MongoDB 的机构权限实现。委托给 {@link OrgDataPermissionService}。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MongoOrgPermissionProvider implements OrgPermissionProvider {

    private final OrgDataPermissionService permissionService;

    @Override
    public Set<String> resolveAccessibleOrgCodes(String projectId, String userOrgCode) {
        return permissionService.resolveAccessibleOrgCodes(projectId, userOrgCode);
    }

    @Override
    public List<String> defaultQueryOrgCodes(String projectId, String userOrgCode) {
        return permissionService.defaultQueryOrgCodes(projectId, userOrgCode);
    }

    @Override
    public List<IndexContext.OrgCandidate> listAccessibleOrgNodes(String projectId, String userOrgCode) {
        return permissionService.listAccessibleOrgNodes(projectId, userOrgCode).stream()
                .map(node -> IndexContext.OrgCandidate.builder()
                        .orgCode(node.getOrgCode())
                        .orgName(node.getOrgName())
                        .pathOrgCodes(node.getPathOrgCodes())
                        .matchedText(null)
                        .managementOrg(node.isManagementOrg())
                        .build())
                .toList();
    }
}
