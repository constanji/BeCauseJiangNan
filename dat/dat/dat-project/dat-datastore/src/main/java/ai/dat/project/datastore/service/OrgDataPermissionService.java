package ai.dat.project.datastore.service;

import ai.dat.project.datastore.document.OrgNodeDocument;
import ai.dat.project.datastore.repository.OrgNodeRepository;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 机构数据权限服务。
 * <p>把"用户的机构身份"翻译成"可访问的 org_code 集合",在指标问数 SQL 生成时
 * 作为 {@code org_code IN (...)} 的强制过滤。
 *
 * <h3>权限规则(由 {@code dataScope} 字段驱动)</h3>
 * <ul>
 *   <li>{@code ALL}                          → 全树所有 org_code</li>
 *   <li>{@code SELF_AND_DESCENDANTS}         → self + 全部后代节点</li>
 *   <li>{@code SELF}                         → 仅 self</li>
 * </ul>
 * <p>{@code dataScope} 在导入表里可留空,按 {@code isManagementOrg + hasChildren} 推断默认值。
 *
 * <h3>缓存</h3>
 * 树结构第一次访问时按 (projectId, dataDt) 加载到内存(自动计算 pathOrgCodes / level),
 * 后续走缓存。导入后调用 {@link #invalidate(String)} 失效缓存。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OrgDataPermissionService {

    private final OrgNodeRepository nodeRepo;

    /** 项目级缓存:loaded tree (orgCode → node)。key = projectId@dataDt */
    private final Map<String, Map<String, OrgNodeDocument>> projectTrees = new ConcurrentHashMap<>();

    /** 项目当前激活的 dataDt（用户手动切换快照）。null 表示自动使用最新。 */
    private final Map<String, String> activeDataDts = new ConcurrentHashMap<>();

    // ─── 缓存管理 ─────────────────────────────────────────────────────────

    /** 强制失效项目缓存(导入新机构信息后调用)。清除该项目所有 dataDt 的快照缓存 + 激活状态。 */
    public void invalidate(String projectId) {
        String prefix = projectId + "@";
        projectTrees.keySet().removeIf(k -> k.startsWith(prefix));
        activeDataDts.remove(projectId);
    }

    /** 仅清空树缓存,不动 activeDataDt。用于单节点更新等增量修改后强制下次重读。 */
    private void invalidateTreeCache(String projectId) {
        String prefix = projectId + "@";
        projectTrees.keySet().removeIf(k -> k.startsWith(prefix));
    }

    /** 设置项目当前激活的 dataDt。设为 null 恢复"自动使用最新"。 */
    public void setActiveDataDt(String projectId, String dataDt) {
        if (dataDt == null || dataDt.isBlank()) {
            activeDataDts.remove(projectId);
        } else {
            activeDataDts.put(projectId, dataDt.trim());
        }
    }

    /** 获取项目当前激活的 dataDt；未手动设置时返回 null（表示自动使用最新）。 */
    public String getActiveDataDt(String projectId) {
        return activeDataDts.get(projectId);
    }

    /**
     * 查询项目下最新的 dataDt。
     * @return 最新数据日期；项目无任何节点时返回 null
     */
    public String resolveLatestDataDt(String projectId) {
        return listAvailableDataDts(projectId).stream().findFirst().orElse(null);
    }

    /** 返回项目下所有可用的 dataDt 快照列表，按时间降序。过滤掉 null 值。 */
    public List<String> listAvailableDataDts(String projectId) {
        List<OrgNodeDocument> nodes = nodeRepo.findByProjectIdOrderByDataDtDesc(projectId);
        if (nodes == null || nodes.isEmpty()) return Collections.emptyList();
        return nodes.stream()
                .map(OrgNodeDocument::getDataDt)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());
    }

    /**
     * 确保项目的树已加载到缓存,返回 (orgCode → node) 映射。
     * <p>若用户手动设置了 activeDataDt 则使用该快照；否则取最新 dataDt。
     */
    private Map<String, OrgNodeDocument> ensureLoaded(String projectId) {
        String activeDt = activeDataDts.get(projectId);
        if (activeDt != null) {
            return ensureLoaded(projectId, activeDt);
        }
        String latestDt = resolveLatestDataDt(projectId);
        if (latestDt != null) {
            return ensureLoaded(projectId, latestDt);
        }
        return Collections.emptyMap();
    }

    /**
     * 确保项目的指定 dataDt 树已加载到缓存。
     * <p>加载过程做两件事:① 给空 dataScope 补默认值;② 计算 pathOrgCodes 和 level。
     */
    private Map<String, OrgNodeDocument> ensureLoaded(String projectId, String dataDt) {
        String cacheKey = projectId + "@" + dataDt;
        Map<String, OrgNodeDocument> cached = projectTrees.get(cacheKey);
        if (cached != null) return cached;
        List<OrgNodeDocument> nodes = nodeRepo.findByProjectIdAndDataDt(projectId, dataDt);
        if (nodes.isEmpty()) return Collections.emptyMap();
        Map<String, OrgNodeDocument> map = nodes.stream()
                .collect(Collectors.toMap(OrgNodeDocument::getOrgCode, n -> n,
                        (a, b) -> a, HashMap::new));
        Set<String> hasChildren = new LinkedHashSet<>();
        for (OrgNodeDocument n : map.values()) {
            if (n.getParentOrgCode() != null) hasChildren.add(n.getParentOrgCode());
        }
        for (OrgNodeDocument n : map.values()) {
            if (n.getDataScope() == null || n.getDataScope().isEmpty()) {
                n.setDataScope(defaultDataScope(n, hasChildren.contains(n.getOrgCode())));
            }
        }
        for (OrgNodeDocument n : map.values()) {
            recomputePathAndLevel(n, map);
        }
        projectTrees.put(cacheKey, map);
        return map;
    }

    /**
     * 根据 brchLv 派生 dataScope；brchLv 为空时回退按 isManagementOrg + hasChildren 推断。
     * <p>公开静态方法：{@link OrgDataPermissionService#deriveDataScope}
     * 供导入服务、修改接口共用，避免各处独立实现导致规则漂移。
     *
     * <h3>规则</h3>
     * <ul>
     *   <li>brchLv=1 → ALL</li>
     *   <li>brchLv=2/3 → SELF_AND_DESCENDANTS</li>
     *   <li>brchLv=4 → SELF</li>
     *   <li>brchLv=null / 其他 → 管理行且有子节点 → SELF_AND_DESCENDANTS；否则 SELF</li>
     * </ul>
     */
    public static String deriveDataScope(Integer brchLv, boolean isManagementOrg, boolean hasChildren) {
        if (brchLv != null) {
            switch (brchLv) {
                case 1: return "ALL";
                case 2:
                case 3: return "SELF_AND_DESCENDANTS";
                case 4: return "SELF";
                default: /* fall through */
            }
        }
        return isManagementOrg && hasChildren ? "SELF_AND_DESCENDANTS" : "SELF";
    }

    private static String defaultDataScope(OrgNodeDocument node, boolean hasChildren) {
        return deriveDataScope(node.getBrchLv(), node.isManagementOrg(), hasChildren);
    }

    /** 沿 parentOrgCode 链向上追溯,组成 path 与 level。深度受树的高度限制,O(深度) 而非 O(N)。 */
    private void recomputePathAndLevel(OrgNodeDocument node, Map<String, OrgNodeDocument> tree) {
        List<String> rev = new ArrayList<>();
        OrgNodeDocument cur = node;
        Set<String> seen = new LinkedHashSet<>();
        while (cur != null && seen.add(cur.getOrgCode())) {
            rev.add(cur.getOrgCode());
            String parent = cur.getParentOrgCode();
            if (parent == null || parent.isEmpty()) break;
            cur = tree.get(parent);
        }
        Collections.reverse(rev);
        node.setPathOrgCodes(String.join("/", rev));
        node.setLevel(rev.size() - 1);
    }

    // ─── 权限解析 ─────────────────────────────────────────────────────────

    /** 用户能访问的全部 org_code 集合;用户不存在/项目无树时返回空集。 */
    public Set<String> resolveAccessibleOrgCodes(String projectId, String userOrgCode) {
        Map<String, OrgNodeDocument> tree = ensureLoaded(projectId);
        OrgNodeDocument user = tree.get(userOrgCode);
        if (user == null) return Collections.emptySet();
        return switch (Objects.requireNonNullElse(user.getDataScope(), "SELF")) {
            case "ALL" -> tree.keySet();
            case "SELF_AND_DESCENDANTS" -> selfAndDescendants(tree, user);
            default -> Set.of(user.getOrgCode());
        };
    }

    /**
     * 默认查询作用域（用户未在问题里提到具体机构时使用）。
     * <ul>
     *   <li>{@code SELF}                  → 只查自身</li>
     *   <li>{@code ALL}                   → 全行预聚合行（brchLv=1 的根，如 FR001）；
     *       找不到根时降级到 self，避免越权也不至于断流</li>
     *   <li>{@code SELF_AND_DESCENDANTS} → 管理行身份取自身；非管理行身份沿父链找最近管理行</li>
     * </ul>
     */
    public List<String> defaultQueryOrgCodes(String projectId, String userOrgCode) {
        if (userOrgCode == null || userOrgCode.isEmpty()) return Collections.emptyList();
        Map<String, OrgNodeDocument> tree = ensureLoaded(projectId);
        OrgNodeDocument userNode = tree.get(userOrgCode);
        if (userNode == null) return List.of(userOrgCode);

        String scope = Objects.requireNonNullElse(userNode.getDataScope(), "SELF");
        if ("SELF".equals(scope)) {
            return List.of(userOrgCode);
        }
        if ("ALL".equals(scope)) {
            String rootCode = findRootOrgCode(tree);
            if (rootCode != null) {
                log.info("ALL scope: default query org resolved from {} -> {}", userOrgCode, rootCode);
                return List.of(rootCode);
            }
            log.warn("ALL scope but no brchLv=1 root found for {}, falling back to self", userOrgCode);
            return List.of(userOrgCode);
        }
        // SELF_AND_DESCENDANTS
        if (userNode.isManagementOrg()) {
            return List.of(userOrgCode);
        }
        String mgmtCode = findNearestManagementOrg(userOrgCode, tree);
        if (mgmtCode != null) {
            log.info("SELF_AND_DESCENDANTS scope: default query org resolved from {} -> {}",
                    userOrgCode, mgmtCode);
            return List.of(mgmtCode);
        }
        log.warn("SELF_AND_DESCENDANTS scope but no management org found for {}, falling back to self", userOrgCode);
        return List.of(userOrgCode);
    }

    /**
     * 找 brchLv=1 的根节点（全行预聚合行）。
     * <p>额外要求 parentOrgCode 为空——一个项目里若有多个 brchLv=1 节点
     * （如业务方把总行部室下某个部门也手改为 lv=1），只有真正的树根才应被选作全行代表。
     */
    private String findRootOrgCode(Map<String, OrgNodeDocument> tree) {
        return tree.values().stream()
                .filter(n -> Integer.valueOf(1).equals(n.getBrchLv()))
                .filter(n -> n.getParentOrgCode() == null || n.getParentOrgCode().isEmpty()
                        || !tree.containsKey(n.getParentOrgCode()))
                .map(OrgNodeDocument::getOrgCode)
                .findFirst()
                .orElse(null);
    }

    // ─── 全树访问(供前端展示) ────────────────────────────────────────

    public Collection<OrgNodeDocument> unsafeListAllNodes(String projectId) {
        return ensureLoaded(projectId).values();
    }

    // ─── 单节点更新（前端 inline 编辑 brchLv 用） ─────────────────────

    /**
     * 更新单个节点的 brchLv，同步派生 dataScope，并清树缓存让下次问数立即生效。
     * <p>用户手动切换的 activeDataDt 不动。
     *
     * @param projectId 项目 ID
     * @param orgCode   机构编码
     * @param newBrchLv 新级别（1/2/3/4）
     * @return 保存后的节点
     * @throws IllegalArgumentException 参数非法 / 节点不存在
     */
    public OrgNodeDocument updateBrchLv(String projectId, String orgCode, Integer newBrchLv) {
        if (projectId == null || projectId.isBlank()) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (orgCode == null || orgCode.isBlank()) {
            throw new IllegalArgumentException("orgCode is required");
        }
        if (newBrchLv == null || newBrchLv < 1 || newBrchLv > 4) {
            throw new IllegalArgumentException("brchLv must be one of 1/2/3/4");
        }
        String dataDt = activeDataDts.get(projectId);
        if (dataDt == null) {
            dataDt = resolveLatestDataDt(projectId);
        }
        if (dataDt == null) {
            throw new IllegalArgumentException("no org snapshot available for project " + projectId);
        }
        final String resolvedDt = dataDt;
        OrgNodeDocument node = nodeRepo.findByProjectIdAndDataDtAndOrgCode(projectId, resolvedDt, orgCode)
                .orElseThrow(() -> new IllegalArgumentException(
                        "org node not found: projectId=" + projectId + ", dataDt=" + resolvedDt + ", orgCode=" + orgCode));

        // 判断是否有子节点（对 brchLv=null 回退分支需要，1/2/3/4 分支其实不看这个）
        boolean hasChildren = nodeRepo.findByProjectIdAndDataDt(projectId, resolvedDt).stream()
                .anyMatch(n -> orgCode.equals(n.getParentOrgCode()));

        node.setBrchLv(newBrchLv);
        node.setDataScope(deriveDataScope(newBrchLv, node.isManagementOrg(), hasChildren));
        OrgNodeDocument saved = nodeRepo.save(node);
        invalidateTreeCache(projectId);
        log.info("Updated brchLv for {}:{}@{} -> brchLv={}, dataScope={}",
                projectId, orgCode, resolvedDt, newBrchLv, saved.getDataScope());
        return saved;
    }

    // ─── 单节点维护（前端手动新增/编辑/删除机构用） ───────────────────────

    /**
     * 手动新增机构节点。
     * <p>节点写入当前激活快照；未手动激活时使用最新快照。若项目尚无快照，则以当前日期创建首个手动快照。
     *
     * @param projectId 项目 ID
     * @param node      待新增节点（需包含 orgCode、orgName、brchLv；parentOrgCode 为空表示根）
     * @return 保存后的节点
     * @throws IllegalArgumentException 参数非法或 orgCode 已存在
     */
    public OrgNodeDocument addOrgNode(String projectId, OrgNodeDocument node) {
        if (projectId == null || projectId.isBlank()) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (node == null) {
            throw new IllegalArgumentException("node is required");
        }
        String orgCode = node.getOrgCode();
        if (orgCode == null || orgCode.isBlank()) {
            throw new IllegalArgumentException("orgCode is required");
        }
        final String code = orgCode.trim();
        if (node.getOrgName() == null || node.getOrgName().isBlank()) {
            throw new IllegalArgumentException("orgName is required");
        }
        Integer brchLv = node.getBrchLv();
        if (brchLv == null || brchLv < 1 || brchLv > 4) {
            throw new IllegalArgumentException("brchLv must be one of 1/2/3/4");
        }

        String targetDt = resolveTargetDataDt(projectId);
        if (targetDt == null) {
            targetDt = LocalDate.now().toString();
            log.info("Project {} has no org snapshot yet, creating manual snapshot {}", projectId, targetDt);
        }
        final String dataDt = targetDt;

        if (nodeRepo.findByProjectIdAndDataDtAndOrgCode(projectId, dataDt, code).isPresent()) {
            throw new IllegalArgumentException("orgCode already exists in current snapshot: " + code);
        }

        String parentCode = normalizeParentOrgCode(node.getParentOrgCode());
        if (parentCode != null && nodeRepo.findByProjectIdAndDataDtAndOrgCode(projectId, dataDt, parentCode).isEmpty()) {
            throw new IllegalArgumentException("parent org not found: " + parentCode);
        }

        // 计算 pathOrgCodes / level：基于当前快照
        Map<String, OrgNodeDocument> tree = buildTreeMap(nodeRepo.findByProjectIdAndDataDt(projectId, dataDt));
        boolean hasChildren = tree.values().stream().anyMatch(n -> code.equals(n.getParentOrgCode()));

        OrgNodeDocument toSave = OrgNodeDocument.builder()
                .projectId(projectId)
                .orgCode(code)
                .orgName(node.getOrgName().trim())
                .parentOrgCode(parentCode)
                .brchLv(brchLv)
                .dataDt(dataDt)
                .dataScope(deriveDataScope(brchLv, Character.isLetter(code.charAt(0)), hasChildren))
                .build();

        tree.put(toSave.getOrgCode(), toSave);
        recomputePathAndLevel(toSave, tree);

        OrgNodeDocument saved = nodeRepo.save(toSave);
        invalidateTreeCache(projectId);
        log.info("Added org node {}:{}@{} for project {}", code, saved.getOrgName(), dataDt, projectId);
        return saved;
    }

    /**
     * 手动编辑机构节点。
     * <p>可修改 orgName、parentOrgCode、brchLv。父节点变更时会重新计算自身及所有后代的
     * pathOrgCodes / level。
     *
     * @param projectId 项目 ID
     * @param orgCode   机构编码
     * @param request   更新请求
     * @return 保存后的节点
     * @throws IllegalArgumentException 参数非法、节点不存在、父节点非法或成环
     */
    public OrgNodeDocument updateOrgNode(String projectId, String orgCode, OrgNodeUpdateRequest request) {
        if (projectId == null || projectId.isBlank()) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (orgCode == null || orgCode.isBlank()) {
            throw new IllegalArgumentException("orgCode is required");
        }
        final String code = orgCode.trim();
        if (request == null) {
            throw new IllegalArgumentException("request is required");
        }

        String targetDt = requireTargetDataDt(projectId);
        OrgNodeDocument node = nodeRepo.findByProjectIdAndDataDtAndOrgCode(projectId, targetDt, code)
                .orElseThrow(() -> new IllegalArgumentException(
                        "org node not found: projectId=" + projectId + ", dataDt=" + targetDt + ", orgCode=" + code));

        boolean changed = false;
        if (request.getOrgName() != null && !request.getOrgName().isBlank()) {
            node.setOrgName(request.getOrgName().trim());
            changed = true;
        }
        if (request.getBrchLv() != null) {
            if (request.getBrchLv() < 1 || request.getBrchLv() > 4) {
                throw new IllegalArgumentException("brchLv must be one of 1/2/3/4");
            }
            node.setBrchLv(request.getBrchLv());
            changed = true;
        }

        String newParentCode = request.getParentOrgCode() != null
                ? normalizeParentOrgCode(request.getParentOrgCode())
                : node.getParentOrgCode();
        String oldParentCode = node.getParentOrgCode();
        boolean parentChanged = !Objects.equals(newParentCode, oldParentCode);
        if (parentChanged) {
            // 加载当前快照全树做环检测与路径重算
            List<OrgNodeDocument> snapshotNodes = nodeRepo.findByProjectIdAndDataDt(projectId, targetDt);
            Map<String, OrgNodeDocument> tree = buildTreeMap(snapshotNodes);

            if (newParentCode != null && !tree.containsKey(newParentCode)) {
                throw new IllegalArgumentException("parent org not found: " + newParentCode);
            }
            if (code.equals(newParentCode)) {
                throw new IllegalArgumentException("cannot set parent to itself");
            }
            if (newParentCode != null && isDescendant(code, newParentCode, tree)) {
                throw new IllegalArgumentException("cannot set parent to a descendant");
            }

            node.setParentOrgCode(newParentCode);
            tree.put(code, node);
            recomputePathAndLevel(node, tree);

            // 父节点变更后，所有后代的路径/层级都需要重算
            Set<String> descendants = collectDescendants(code, tree);
            for (OrgNodeDocument n : tree.values()) {
                if (descendants.contains(n.getOrgCode())) {
                    recomputePathAndLevel(n, tree);
                }
            }
            nodeRepo.saveAll(tree.values().stream()
                    .filter(n -> n.getOrgCode().equals(code) || descendants.contains(n.getOrgCode()))
                    .collect(Collectors.toList()));
            changed = true;
        }

        if (request.getBrchLv() != null) {
            boolean hasChildren = nodeRepo.findByProjectIdAndDataDt(projectId, targetDt).stream()
                    .anyMatch(n -> code.equals(n.getParentOrgCode()));
            node.setDataScope(deriveDataScope(node.getBrchLv(), node.isManagementOrg(), hasChildren));
            changed = true;
        }

        OrgNodeDocument saved = changed ? nodeRepo.save(node) : node;
        invalidateTreeCache(projectId);
        log.info("Updated org node {}:{}@{} for project {}", code, saved.getOrgName(), targetDt, projectId);
        return saved;
    }

    /**
     * 手动删除机构节点。
     *
     * @param projectId 项目 ID
     * @param orgCode   机构编码
     * @param cascade   是否级联删除子节点
     * @throws IllegalArgumentException 节点不存在或有子节点但未级联删除
     */
    public void deleteOrgNode(String projectId, String orgCode, boolean cascade) {
        if (projectId == null || projectId.isBlank()) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (orgCode == null || orgCode.isBlank()) {
            throw new IllegalArgumentException("orgCode is required");
        }
        final String code = orgCode.trim();

        String targetDt = requireTargetDataDt(projectId);
        OrgNodeDocument node = nodeRepo.findByProjectIdAndDataDtAndOrgCode(projectId, targetDt, code)
                .orElseThrow(() -> new IllegalArgumentException(
                        "org node not found: projectId=" + projectId + ", dataDt=" + targetDt + ", orgCode=" + code));

        List<OrgNodeDocument> snapshotNodes = nodeRepo.findByProjectIdAndDataDt(projectId, targetDt);
        Map<String, OrgNodeDocument> tree = buildTreeMap(snapshotNodes);
        Set<String> descendants = collectDescendants(code, tree);

        if (!descendants.isEmpty() && !cascade) {
            throw new IllegalArgumentException(
                    "org node has children; set cascade=true to delete the whole subtree, or delete children first");
        }

        List<OrgNodeDocument> toDelete = new ArrayList<>();
        toDelete.add(node);
        for (String dCode : descendants) {
            OrgNodeDocument d = tree.get(dCode);
            if (d != null && d.getId() != null) {
                toDelete.add(d);
            }
        }
        nodeRepo.deleteAll(toDelete);
        invalidateTreeCache(projectId);
        log.info("Deleted {} org node(s) for project {} in snapshot {} (cascade={})",
                toDelete.size(), projectId, targetDt, cascade);
    }

    /**
     * 单节点更新请求对象。
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrgNodeUpdateRequest {
        private String orgName;
        private String parentOrgCode;
        private Integer brchLv;
    }

    // ─── 手动维护辅助方法 ─────────────────────────────────────────────────

    /** 解析手动操作的目标快照：用户主动激活的优先，否则取最新。 */
    private String resolveTargetDataDt(String projectId) {
        String activeDt = activeDataDts.get(projectId);
        if (activeDt != null) {
            return activeDt;
        }
        return resolveLatestDataDt(projectId);
    }

    /** 解析目标快照，不存在则抛异常（用于编辑/删除）。 */
    private String requireTargetDataDt(String projectId) {
        String dt = resolveTargetDataDt(projectId);
        if (dt == null) {
            throw new IllegalArgumentException("no org snapshot available for project " + projectId);
        }
        return dt;
    }

    /** 统一父节点编码归一化：00000 / 空 / null 都视为根节点（null）。 */
    private String normalizeParentOrgCode(String parentOrgCode) {
        if (parentOrgCode == null || parentOrgCode.isBlank() || "00000".equals(parentOrgCode.trim())) {
            return null;
        }
        String trimmed = parentOrgCode.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** 将节点列表构建为 orgCode → node 映射，不计算 path/level。 */
    private Map<String, OrgNodeDocument> buildTreeMap(List<OrgNodeDocument> nodes) {
        Map<String, OrgNodeDocument> map = new HashMap<>();
        for (OrgNodeDocument n : nodes) {
            if (n.getOrgCode() != null) {
                map.put(n.getOrgCode(), n);
            }
        }
        return map;
    }

    /** 判断 candidate 是否为 ancestor 的后代节点（在 tree 中沿 parent 向上）。 */
    private boolean isDescendant(String ancestor, String candidate, Map<String, OrgNodeDocument> tree) {
        Set<String> seen = new LinkedHashSet<>();
        String cur = candidate;
        while (cur != null && seen.add(cur)) {
            OrgNodeDocument node = tree.get(cur);
            if (node == null) break;
            String parent = node.getParentOrgCode();
            if (ancestor.equals(parent)) {
                return true;
            }
            cur = parent;
        }
        return false;
    }

    /** 收集指定节点的所有后代 orgCode（不包含自身）。 */
    private Set<String> collectDescendants(String orgCode, Map<String, OrgNodeDocument> tree) {
        Set<String> result = new LinkedHashSet<>();
        List<String> frontier = new ArrayList<>();
        frontier.add(orgCode);
        while (!frontier.isEmpty()) {
            List<String> next = new ArrayList<>();
            for (OrgNodeDocument n : tree.values()) {
                if (n.getParentOrgCode() != null && frontier.contains(n.getParentOrgCode())
                        && !orgCode.equals(n.getOrgCode()) && result.add(n.getOrgCode())) {
                    next.add(n.getOrgCode());
                }
            }
            frontier = next;
        }
        return result;
    }

    /**
     * 返回当前用户权限范围内全部机构节点，用于机构名解析。
     * <p>过滤规则：仅当用户是 SELF-scope 的普通支行时（orgCode 纯数字），才把候选里的管理行剔除，
     * 防止越权访问管理行预聚合数据。ALL / SELF_AND_DESCENDANTS 用户即便 orgCode 是数字（如 8011
     * 总行部室下属部门配置了 ALL），也应能命中管理行候选（用于回答"分行/总行"等口径的问题）。
     */
    public List<OrgNodeDocument> listAccessibleOrgNodes(String projectId, String userOrgCode) {
        Set<String> accessible = resolveAccessibleOrgCodes(projectId, userOrgCode);
        if (accessible.isEmpty()) {
            return Collections.emptyList();
        }
        Map<String, OrgNodeDocument> tree = ensureLoaded(projectId);
        List<OrgNodeDocument> nodes = accessible.stream()
                .map(tree::get)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        OrgNodeDocument userNode = tree.get(userOrgCode);
        if (userNode != null && !userNode.isManagementOrg()
                && "SELF".equals(Objects.requireNonNullElse(userNode.getDataScope(), "SELF"))) {
            nodes = nodes.stream()
                    .filter(n -> !n.isManagementOrg())
                    .collect(Collectors.toList());
        }
        return nodes;
    }

    // ─── 树遍历工具 ───────────────────────────────────────────────────────

    private Set<String> selfAndDescendants(Map<String, OrgNodeDocument> tree, OrgNodeDocument root) {
        Set<String> result = new LinkedHashSet<>();
        result.add(root.getOrgCode());
        String rootPath = root.getPathOrgCodes();
        if (rootPath == null || rootPath.isEmpty()) {
            return bfsDescendants(tree, root);
        }
        String prefix = rootPath + "/";
        for (OrgNodeDocument n : tree.values()) {
            String path = n.getPathOrgCodes();
            if (path != null && path.startsWith(prefix)) {
                result.add(n.getOrgCode());
            }
        }
        return result;
    }

    private Set<String> bfsDescendants(Map<String, OrgNodeDocument> tree, OrgNodeDocument root) {
        Set<String> result = new LinkedHashSet<>();
        result.add(root.getOrgCode());
        List<String> frontier = new ArrayList<>();
        frontier.add(root.getOrgCode());
        while (!frontier.isEmpty()) {
            List<String> next = new ArrayList<>();
            for (OrgNodeDocument n : tree.values()) {
                if (frontier.contains(n.getParentOrgCode()) && result.add(n.getOrgCode())) {
                    next.add(n.getOrgCode());
                }
            }
            frontier = next;
        }
        return result;
    }

    /**
     * 沿 parentOrgCode 链向上查找最近的管理行。
     * @return 最近管理行的 orgCode；自身就是管理行则返回自身；找不到返回 null
     */
    private String findNearestManagementOrg(String startOrgCode, Map<String, OrgNodeDocument> tree) {
        if (startOrgCode == null) return null;
        OrgNodeDocument cur = tree.get(startOrgCode);
        if (cur == null) return null;
        Set<String> seen = new LinkedHashSet<>();
        while (cur != null && seen.add(cur.getOrgCode())) {
            if (cur.isManagementOrg()) {
                return cur.getOrgCode();
            }
            String parent = cur.getParentOrgCode();
            if (parent == null || parent.isEmpty()) break;
            cur = tree.get(parent);
        }
        return null;
    }
}
