package ai.dat.core.index.resolver;

import ai.dat.core.contentstore.ContentStore;
import ai.dat.core.contentstore.data.IndexEntry;
import ai.dat.core.contentstore.data.WordSynonymPair;
import ai.dat.core.index.data.IndexCaliberGroup;
import ai.dat.core.index.data.IndexContext;
import ai.dat.core.index.data.QueryKind;
import ai.dat.core.index.provider.IndexEntryProvider;
import ai.dat.core.index.provider.OrgPermissionProvider;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 指标问数请求级上下文编排器。
 * <p>在每次问数请求开始时调用,把"用户问题 + 身份"翻译成下游 SQL 生成需要的全部约束:
 * <ul>
 *   <li>候选指标——LightSchema 风格:把项目全部指标直接交给意图分类 LLM 让它自选,
 *       不再在 Resolver 阶段做向量召回+topK 截断(这会因"标准名带口径括号、问题文本不带"
 *       这种形态差异导致正确指标被裁掉)</li>
 *   <li>多口径分组(用于"相似问"提示,基于 LLM 选中的 standardName 在全量库内回填)</li>
 *   <li>用户可访问 org_code 集合 + 本次查询使用的 org_code 列表(由 dataScope 决定)</li>
 *   <li>日期场景</li>
 *   <li>查询类型 + SELECT 字段白名单</li>
 * </ul>
 *
 * <p>caliberGroups 与 similarIndices 这两类「相似问」回填发生在 DefaultAskdataAgent
 * 拿到 selected_index_numbers 之后,本类只负责构造全量候选与共享上下文。
 *
 * <p>身份校验(staffNo 是否真属于 orgCode)已废弃,本服务只按 orgCode 推算数据权限范围。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@RequiredArgsConstructor
public class IndexContextResolver {

    /**
     * 全量候选的硬上限——超过这个数量 prompt token 开销已不合理,
     * 落到这种规模通常意味着指标库导入错了(按行业实际,一个项目<500 条)。
     */
    private static final int FULL_CANDIDATE_HARD_LIMIT = 1000;

    /**
     * 排名意图识别关键词。
     * <p>同时识别阿拉伯数字 (前 5/第 3 名) 与中文数字 (前三/第三名),
     * 与 {@code RuleBasedSqlBuilder.detectRankingLimit} 的解析能力对齐 —— 不然
     * "前三名" 会被识别成 STANDARD 走通用模板,而 builder 其实有完整的排名模板。
     */
    private static final Pattern RANKING_KEYWORDS = Pattern.compile(
            "排名|排行|降序|升序|最高|最低|最大|最小|倒数" +
                    "|前\\s*(\\d+|[一二三四五六七八九十])" +
                    "|第\\s*(\\d+|[一二三四五六七八九十])\\s*[名位]");

    private final IndexEntryProvider indexProvider;
    private final OrgPermissionProvider permProvider;
    private final DateScenarioDetector dateDetector;
    private final CurrencyDetector currencyDetector;
    private final ai.dat.core.index.bm25.IndexBm25Index bm25Index;

    /**
     * 解析请求上下文。
     * <p>任何空入参或召回失败都会降级到 {@code enabled=false} 的空 Context。
     */
    public IndexContext resolve(ContentStore contentStore,
                                 String projectId,
                                 String question,
                                 String orgCode) {
        if (projectId == null || projectId.isEmpty() || question == null || question.isBlank()) {
            return IndexContext.disabled();
        }

        // 1) 候选指标 —— 默认先缩窄到与问题相关的子集，再在必要时回退全量
        List<IndexEntry> allCandidates = listAllSafely(projectId);
        if (allCandidates.isEmpty()) {
            return IndexContext.disabled();
        }
        if (allCandidates.size() > FULL_CANDIDATE_HARD_LIMIT) {
            log.warn("Project {} has {} index entries (>{} limit), truncating to keep prompt sane. " +
                    "Consider splitting projects or raising the limit.",
                    projectId, allCandidates.size(), FULL_CANDIDATE_HARD_LIMIT);
            allCandidates = allCandidates.subList(0, FULL_CANDIDATE_HARD_LIMIT);
        }

        List<IndexEntry> candidates = narrowCandidatesForQuestion(question, allCandidates, contentStore, projectId);
        if (candidates.isEmpty()) {
            // 检索无结果 → 指标问数不适用,降级走普通 LightSchema 意图分类
            return IndexContext.disabled();
        }

        // 2) 日期场景 — 默认 NONE，由 LLM 意图分类提取真实值
        //    规则 DateScenarioDetector 仅在 LLM 未返回时作兜底(DefaultAskdataAgent)

        // 2.5) 币种 — 默认 CN(折人民币)，由 LLM 意图分类提取真实值
        //    规则 CurrencyDetector 仅在 LLM 未返回时作兜底(DefaultAskdataAgent)

        // 3) 机构候选解析（在 query kind 和 SQL 约束之前）
        if (orgCode == null || orgCode.isBlank()) {
            log.warn("orgCode is null/blank for project {}, disabling index-ask mode to prevent unauthorized access", projectId);
            return IndexContext.disabled();
        }
        Set<String> accessible = permProvider.resolveAccessibleOrgCodes(projectId, orgCode);
        if (accessible.isEmpty()) {
            log.warn("orgCode {} has no accessible orgs in project {}, disabling index-ask mode", orgCode, projectId);
            return IndexContext.disabled();
        }
        // 机构候选列表（传给 LLM 做语义识别，不在此阶段做字符串匹配）
        List<IndexContext.OrgCandidate> orgCandidates = permProvider.listAccessibleOrgNodes(projectId, orgCode);
        if (orgCandidates == null) {
            orgCandidates = Collections.emptyList();
        }
        // v3: 机构混合检索——对用户可访问的全部机构建 BM25 索引，按问题相关性取 top-K，
        // 大幅缩减 LLM prompt 中的 ORG CANDIDATES 数量（例如从 91 → 5）
        List<IndexContext.OrgCandidate> topOrgCandidates = narrowOrgCandidates(question, orgCandidates);
        // v4: 同名机构去重——当管理行和普通支行同名时（例如 A0001 北京分行 vs 000001 北京分行），
        // 根据用户 orgType 和问题中的显式提示，选择正确的机构层级
        topOrgCandidates = resolveDuplicateOrgNames(topOrgCandidates, orgCode, permProvider, projectId, question);
        // 初始状态：候选已准备好，但尚未解析（等 LLM 意图分类返回 selected_org_codes）
        OrgResolution resolution = OrgResolution.unresolved(topOrgCandidates);

        // 4) 查询类型 + 字段白名单
        //    注意：此阶段还未选出具体指标，暂用 STANDARD；
        //    Agent 在 LLM 选出指标后会根据实际选中的指标编号动态调整。
        QueryKind kind = detectKind(question, resolution);
        List<String> whitelist = (kind == QueryKind.RANKING)
                ? IndexColumnWhitelist.RANKING
                : IndexColumnWhitelist.STANDARD;

        // 5) 权限解析
        //    - accessible:用户可访问全集,只用于越权校验 / 上层元信息
        //    - queryOrgs:STANDARD/ORG_AGGREGATION/同业查询写进 SQL 的 org_code IN 集合
        //      STANDARD 默认只查自己一条聚合；若问题显式命中机构，则用解析出的机构覆盖
        //      RANKING  对齐 kpi.sql:不走数据权限 IN(...)，而是用 org_code REGEXP + 固定黑名单
        List<String> queryOrgs;
        if (kind == QueryKind.RANKING) {
            queryOrgs = Collections.emptyList();
        } else if (!resolution.orgCodes().isEmpty()) {
            queryOrgs = resolution.orgCodes();
        } else {
            queryOrgs = permProvider.defaultQueryOrgCodes(projectId, orgCode);
        }

        RankingScope rankingScope = kind == QueryKind.RANKING
                ? detectRankingScope(projectId, orgCode, accessible, permProvider, question)
                : RankingScope.none();

        return IndexContext.builder()
                .enabled(true)
                .projectId(projectId)
                .userOrgCode(orgCode)
                .indexCandidates(candidates)
                .indexReferenceSummaries(buildIndexReferenceSummaries(candidates))
                // 同名分组在 Agent 拿到 selected_index_numbers 之后再用全量库回填,
                // Resolver 阶段不预先计算,避免把全量库里所有同名分组都塞进相似问事件。
                .caliberGroups(Collections.emptyList())
                .accessibleOrgCodes(accessible)
                .queryOrgCodes(queryOrgs)
                .resolvedOrgCodes(resolution.orgCodes())
                .resolvedOrgNames(resolution.orgNames())
                .mentionedOrgCandidates(resolution.candidates())
                .orgResolutionMode(resolution.mode())
                .orgAggregationMode(resolution.aggregationMode())
                .selectColumnsWhitelist(whitelist)
                .queryKind(kind)
                .rankingOrgLevelLabel(rankingScope.orgLevelLabel())
                .build();
    }

    // ─── 机构 BM25 缩窄（v3 新增） ──────────────────────────────────────

    /** BM25 检索 top-K 机构。太小会漏掉多机构查询的第二个 org，太大 prompt 又太重。 */
    private static final int ORG_BM25_TOP_K = 15;

    private List<IndexContext.OrgCandidate> narrowOrgCandidates(String question,
                                                                  List<IndexContext.OrgCandidate> allOrgs) {
        if (allOrgs == null || allOrgs.size() <= ORG_BM25_TOP_K) return allOrgs;
        try {
            // 只保留有名字的机构,并按 orgCode 索引(去重)
            Map<String, IndexContext.OrgCandidate> byCode = new LinkedHashMap<>();
            for (IndexContext.OrgCandidate o : allOrgs) {
                if (o.getOrgName() != null && !o.getOrgName().isBlank()) {
                    byCode.putIfAbsent(o.getOrgCode(), o);
                }
            }
            // 按 orgName 长度降序:名字越长越具体,精确/软匹配时优先
            List<IndexContext.OrgCandidate> sortedByNameLen = byCode.values().stream()
                    .sorted((a, b) -> Integer.compare(b.getOrgName().length(), a.getOrgName().length()))
                    .toList();

            // 第一轮：精确子串匹配（处理多机构问题，如"北京城南支行和北京金融街支行"）
            List<String> exactOrdered = new ArrayList<>();
            for (IndexContext.OrgCandidate o : sortedByNameLen) {
                if (question.contains(o.getOrgName())) {
                    exactOrdered.add(o.getOrgCode());
                }
            }
            // 第 1.5 轮：软匹配 — 对齐指标匹配的 selectSoftMatches，处理地名后缀差异
            // 如"溧阳支行" vs "溧阳市支行"（精确子串因"市"字失败，BM25 可能被"丹阳支行"干扰）
            List<String> softOrdered = new ArrayList<>();
            for (IndexContext.OrgCandidate o : sortedByNameLen) {
                if (exactOrdered.contains(o.getOrgCode())) continue;
                if (isSoftOrgMatch(question, o.getOrgName())) {
                    softOrdered.add(o.getOrgCode());
                }
            }
            // 第二轮：BM25 补充（子串没命中的模糊匹配，如"城东支行" vs "北京城东支行"）
            Set<String> seen = new LinkedHashSet<>();
            exactOrdered.forEach(seen::add);
            softOrdered.forEach(seen::add);
            List<String> bm25Ordered = new ArrayList<>();
            int remaining = ORG_BM25_TOP_K - seen.size();
            if (remaining > 0) {
                Map<String, String> orgMap = new LinkedHashMap<>();
                for (IndexContext.OrgCandidate o : allOrgs) {
                    if (o.getOrgName() != null && !o.getOrgName().isBlank()
                            && !seen.contains(o.getOrgCode())) {
                        orgMap.put(o.getOrgCode(), o.getOrgName());
                    }
                }
                if (!orgMap.isEmpty()) {
                    ai.dat.core.index.bm25.IndexBm25Index orgBm25 = new ai.dat.core.index.bm25.IndexBm25Index();
                    orgBm25.buildFromTextMap(orgMap);
                    for (ai.dat.core.index.bm25.Bm25Hit hit : orgBm25.search(question, remaining)) {
                        if (seen.add(hit.indexNumber())) {
                            bm25Ordered.add(hit.indexNumber());
                        }
                    }
                }
            }
            // 机构为空走用户默认的机构
            if (seen.isEmpty()) {
                return new ArrayList<>();
            }
            // BM25 同分时按"网点优先级"稳定排序:支行/分行/储蓄所/网点/营业部 排在 库区/办事处 之前。
            // 用户只打地名(如"金坛贷款余额"里的"金坛")时通常指该地银行网点,而非专业库区;
            // 稳定排序保留 BM25 原始分数顺序,仅在同级别内重排,确保网点候选排在前面交给 LLM。
            bm25Ordered = sortByOutletPreference(bm25Ordered, byCode);

            // 合并三组,保持命中类型优先级:精确 → 软匹配 → BM25(网点优先)
            // 注意:不再用 allOrgs 顺序重排,否则会抹掉上面的命中优先级与 BM25 分数顺序。
            List<String> ordered = new ArrayList<>(exactOrdered);
            for (String c : softOrdered) {
                if (!ordered.contains(c)) ordered.add(c);
            }
            for (String c : bm25Ordered) {
                if (!ordered.contains(c)) ordered.add(c);
            }
            List<IndexContext.OrgCandidate> narrowed = ordered.stream()
                    .map(byCode::get)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());
            log.info("Org narrowed from {} to {} (exact={} soft={} bm25={}) for question [{}]",
                    allOrgs.size(), narrowed.size(),
                    exactOrdered.size(), softOrdered.size(), bm25Ordered.size(),
                    question.length() > 60 ? question.substring(0, 60) + "..." : question);
            return narrowed;
        } catch (Exception e) {
            log.warn("Org narrow failed, keeping all {} orgs: {}", allOrgs.size(), e.getMessage());
        }
        return allOrgs;
    }

    /** 网点名称后缀:命中视为"银行网点",在地名歧义时优先于库区/办事处等专业机构。 */
    private static final Pattern OUTLET_SUFFIX_PATTERN =
            Pattern.compile("(支行|分行|储蓄所|网点|营业部|分理处)$");

    /**
     * BM25 命中按"网点优先"做稳定排序:名称以 支行/分行/储蓄所/网点/营业部/分理处 结尾的排前,
     * 其余(库区/办事处等)排后;同级保持 BM25 分数顺序(Java sort 稳定)。
     */
    static List<String> sortByOutletPreference(List<String> codes,
                                               Map<String, IndexContext.OrgCandidate> byCode) {
        if (codes == null || codes.isEmpty()) return codes;
        return codes.stream()
                .sorted(Comparator.comparingInt((String c) -> outletRank(byCode.get(c))))
                .collect(Collectors.toList());
    }

    /** 网点名称 → 0;非网点(库区/办事处等) → 1。null 安全。 */
    static int outletRank(IndexContext.OrgCandidate o) {
        if (o == null || o.getOrgName() == null) return 1;
        return OUTLET_SUFFIX_PATTERN.matcher(o.getOrgName()).find() ? 0 : 1;
    }

    // ─── 同名机构去重（v4 新增） ──────────────────────────────────────────────

    /**
     * 同名机构去重：当管理行和普通支行使用相同名称时（例如 A0001 北京分行 vs 000001 北京分行），
     * 根据用户 orgType 和问题中的显式提示保留正确的机构层级。
     *
     * <h3>规则</h3>
     * <ul>
     *   <li>问题显式包含"管理行" → 强制保留管理行（{@code managementOrg=true}）</li>
     *   <li>问题显式包含"支行"/"网点"/"储蓄所" → 强制保留普通支行（{@code managementOrg=false}）</li>
     *   <li>用户为 SUB_BRANCH → 保留 SUB_BRANCH（非管理行）</li>
     *   <li>用户为 BRANCH / HEAD_OFFICE / HEAD_DEPT → 保留管理行</li>
     *   <li>其他情况（如两个同类型同名） → 全部保留，交给 LLM 决策</li>
     * </ul>
     */
    static List<IndexContext.OrgCandidate> resolveDuplicateOrgNames(
            List<IndexContext.OrgCandidate> candidates,
            String userOrgCode,
            OrgPermissionProvider permProvider,
            String projectId,
            String question) {
        if (candidates == null || candidates.size() <= 1) return candidates;
        if (candidates.isEmpty()) return candidates;

        // 按 orgName 分组，检查是否存在同名
        Map<String, List<IndexContext.OrgCandidate>> byName = candidates.stream()
                .filter(c -> c.getOrgName() != null && !c.getOrgName().isBlank())
                .collect(Collectors.groupingBy(IndexContext.OrgCandidate::getOrgName, LinkedHashMap::new,
                        Collectors.toList()));

        boolean hasDuplicates = byName.values().stream().anyMatch(g -> g.size() > 1);
        if (!hasDuplicates) return candidates;

        // 严格按用户 orgCode 字母前缀路由,不再解析问题文本里的"支行/网点/管理行"等关键词,
        // 避免被"金坛支行"这种机构名带偏。
        // <p>线上 orgType 区分粒度不够（A0008 管理行 与 01201 普通支行 都是 SUB_BRANCH），
        // 字母前缀才是唯一可靠的区分依据：
        //   FR001 / A8000 / A* (管理行)   → 选管理行(KPI 已预聚合)
        //   纯数字 (普通支行)               → 选普通支行(仅自身数据)
        boolean userIsManagement = isManagementOrgCode(userOrgCode);

        List<IndexContext.OrgCandidate> resolved = new ArrayList<>();
        for (Map.Entry<String, List<IndexContext.OrgCandidate>> entry : byName.entrySet()) {
            List<IndexContext.OrgCandidate> sameName = entry.getValue();
            if (sameName.size() == 1) {
                resolved.add(sameName.get(0));
                continue;
            }

            // 同名冲突 → 按用户管理身份选择
            List<IndexContext.OrgCandidate> mgmt = sameName.stream()
                    .filter(IndexContext.OrgCandidate::isManagementOrg)
                    .toList();
            List<IndexContext.OrgCandidate> nonMgmt = sameName.stream()
                    .filter(c -> !c.isManagementOrg())
                    .toList();

            if (mgmt.isEmpty() || nonMgmt.isEmpty()) {
                // 同名但全部是同一类（全是管理行或全是普通支行）→ 都保留，LLM 决策
                resolved.addAll(sameName);
                log.debug("Duplicate org names all same kind for '{}', keeping all {} candidates",
                        entry.getKey(), sameName.size());
                continue;
            }

            if (userIsManagement) {
                resolved.addAll(mgmt);
                log.info("Org name '{}' resolved to management org(s) {} (userOrgCode={})",
                        entry.getKey(),
                        mgmt.stream().map(IndexContext.OrgCandidate::getOrgCode).toList(),
                        userOrgCode);
            } else {
                resolved.addAll(nonMgmt);
                log.info("Org name '{}' resolved to sub-branch org(s) {} (userOrgCode={})",
                        entry.getKey(),
                        nonMgmt.stream().map(IndexContext.OrgCandidate::getOrgCode).toList(),
                        userOrgCode);
            }
        }
        return resolved;
    }

    /**
     * 按 orgCode 字母前缀判断是否管理行账号。
     * <p>线上银行机构编码约定：FR001 / A8000 / A* 为管理行；纯数字（如 01201）为普通支行。
     * 本地测试夹具可能不同（如 H/B/S 前缀），由各自测试用例自行处理。
     */
    static boolean isManagementOrgCode(String orgCode) {
        return orgCode != null && !orgCode.isEmpty()
                && Character.isLetter(orgCode.charAt(0));
    }

    // ─── 机构软匹配（v5 新增，对齐指标匹配的 selectSoftMatches） ─────────

    /** 常见地名后缀，在软匹配时去掉以处理"溧阳支行" vs "溧阳市支行"这类差异。 */
    private static final Pattern GEO_SUFFIX_PATTERN =
            Pattern.compile("[市县区镇乡]$");

    /**
     * 机构名软匹配：去掉地名后缀后做双向包含 + 字符重叠度兜底。
     * <p>对标指标匹配的 {@link #selectSoftMatches}，让机构匹配在精确子串失败后、
     * BM25 之前有一次模糊兜底，解决"溧阳支行" vs "溧阳市支行"这类地名后缀差异。
     */
    private static boolean isSoftOrgMatch(String question, String orgName) {
        if (question == null || question.isBlank() || orgName == null || orgName.isBlank()) {
            return false;
        }
        // 1) 去掉地名后缀后的模糊名
        String fuzzyName = GEO_SUFFIX_PATTERN.matcher(orgName).replaceAll("");
        if (fuzzyName.length() < 2) return false; // 去后缀后太短，不参与模糊匹配

        // 2) 问题包含去后缀后的机构名（如"溧阳支行各项存款..." contains "溧阳支行"）
        if (question.contains(fuzzyName)) return true;

        // 3) 提取问题中的机构关键词，与 fuzzyName 做双向匹配
        String orgKeyword = extractOrgKeyword(question);
        if (!orgKeyword.isEmpty()) {
            // 3a) 去后缀机构名包含关键词（如"溧阳市支行"去掉"市"后 contains "溧阳"）
            if (fuzzyName.contains(orgKeyword)) return true;
            // 3b) 关键词与 fuzzyName 的字符重叠度 ≥70%（如"栗阳" vs "溧阳"）
            if (charOverlapRatio(orgKeyword, fuzzyName) >= 0.7) return true;
        }

        // 4) 全问题文本与 fuzzyName 的字符重叠度兜底（仅在未提取到机构关键词时）
        if (orgKeyword.isEmpty() && charOverlapRatio(question, fuzzyName) >= 0.7) return true;

        return false;
    }

    /**
     * 从问题中提取可能的机构关键词：去掉常见指标词/查询词后，取与机构名可能重合的部分。
     * <p>简单策略：取问题中"支行/分行/部门"之前的连续中文字段作为机构关键词。
     */
    private static String extractOrgKeyword(String question) {
        if (question == null || question.isBlank()) return "";
        // 尝试匹配 "XXX支行" 模式
        java.util.regex.Matcher m = Pattern.compile(
                "([\\u4e00-\\u9fa5]{2,10})(?:支行|分行|部门|网点|储蓄所)").matcher(question);
        if (m.find()) {
            return m.group(1);
        }
        return "";
    }

    // ─── 全量候选拉取 ────────────────────────────────────────────────────

    private List<IndexEntry> listAllSafely(String projectId) {
        try {
            List<IndexEntry> all = indexProvider.listAll(projectId);
            return all == null ? Collections.emptyList() : all;
        } catch (UnsupportedOperationException uoe) {
            return Collections.emptyList();
        } catch (Exception e) {
            log.warn("Index listAll failed for project {}: {}", projectId, e.getMessage());
            return Collections.emptyList();
        }
    }

    private List<IndexEntry> narrowCandidatesForQuestion(String question,
                                                         List<IndexEntry> allCandidates,
                                                         ContentStore contentStore,
                                                         String projectId) {
        if (question == null || question.isBlank() || allCandidates == null || allCandidates.isEmpty()) {
            return Collections.emptyList();
        }

        // 0) 从同义词推断口径偏好:同义词"存款余额→各项存款余额人行口径"可推断 source=1
        Integer inferredSource = inferSourceFromSynonyms(question, allCandidates, contentStore);

        // 1) 确定性匹配(精确归一化后相等) — 命中时直接返回,不混入向量噪声
        List<IndexEntry> deterministic = selectDeterministicMatches(question, allCandidates);
        if (!deterministic.isEmpty()) {
            // 同义词推断的口径可用于消歧:当匹配到多条不同口径时,优先返回同义词指向的口径
            if (inferredSource != null && deterministic.size() > 1) {
                List<IndexEntry> filtered = filterBySource(deterministic, inferredSource);
                if (!filtered.isEmpty()) {
                    log.info("Narrowed to {} deterministic matches (synonym-inferred source={}) for question [{}]",
                            filtered.size(), inferredSource, question);
                    return filtered;
                }
            }
            log.info("Narrowed to {} deterministic matches for question [{}]", deterministic.size(), question);
            return deterministic;
        }

        // 2) 软匹配:问题去掉查询词后,与标准名/别名做包含匹配 — 命中时直接返回
        List<IndexEntry> soft = selectSoftMatches(question, allCandidates);
        if (!soft.isEmpty()) {
            if (inferredSource != null && soft.size() > 1) {
                List<IndexEntry> filtered = filterBySource(soft, inferredSource);
                if (!filtered.isEmpty()) {
                    log.info("Narrowed to {} soft matches (synonym-inferred source={}) for question [{}]",
                            filtered.size(), inferredSource, question);
                    return filtered;
                }
            }
            log.info("Narrowed to {} soft matches for question [{}]", soft.size(), question);
            return soft;
        }

        // 3) 向量召回(只在确定性匹配和软匹配都失败时才用)
        // 返回候选由上层 Agent 用 cross-encoder 评分决定是否启用 index-ask
        LinkedHashMap<String, IndexEntry> narrowed = new LinkedHashMap<>();
        try {
            for (IndexEntry e : indexProvider.retrieve(projectId, question)) {
                narrowed.putIfAbsent(e.getIndexNumber(), e);
            }
        } catch (Exception ex) {
            log.warn("Index retrieve failed for project {}: {}", projectId, ex.getMessage());
        }
        try {
            if (contentStore != null) {
                for (IndexEntry e : contentStore.retrieveIndexEntries(projectId, question, 20)) {
                    if (e != null && e.getIndexNumber() != null) {
                        narrowed.putIfAbsent(e.getIndexNumber(), e);
                    }
                }
            }
        } catch (Exception ex) {
            log.warn("Index vector retrieve failed for project {}: {}", projectId, ex.getMessage());
        }

        if (narrowed.isEmpty()) {
            return Collections.emptyList();
        }
        // 候选太少容易错过跨口径/近邻；太多则失去缩窄意义。设置一个温和上限。
        log.info("No exact/soft match for question [{}], vector recall returned {} candidates",
                question.length() > 80 ? question.substring(0, 80) + "..." : question, narrowed.size());
        return new ArrayList<>(narrowed.values().stream().limit(80).toList());
    }

    // ─── 同义词口径推断 ────────────────────────────────────────────────

    /**
     * 从同义词库中推断用户可能偏好的口径。
     * <p>例：同义词配置 "存款余额 → 各项存款余额人行口径"，
     * 当用户问题包含"存款余额"且指标库中存在 source=1 的"各项存款余额(人行口径)"条目时，
     * 返回 source=1 作为口径偏好，后续匹配阶段据此消歧。
     *
     * @return 推断的口径 source（1=人行/2=监管/3=省联社），无法推断时返回 null
     */
    private Integer inferSourceFromSynonyms(String question,
                                            List<IndexEntry> allCandidates,
                                            ContentStore contentStore) {
        if (contentStore == null || question == null || question.isBlank()
                || allCandidates == null || allCandidates.isEmpty()) {
            return null;
        }
        try {
            List<WordSynonymPair> synonyms = contentStore.retrieveSyn(question);
            if (synonyms == null || synonyms.isEmpty()) {
                return null;
            }
            for (WordSynonymPair pair : synonyms) {
                String word = pair.getWord();
                if (word == null || word.isBlank() || !question.contains(word)) {
                    continue;
                }
                List<String> syns = pair.getSynonyms();
                if (syns == null || syns.isEmpty()) {
                    continue;
                }
                for (String syn : syns) {
                    if (syn == null || syn.isBlank()) {
                        continue;
                    }
                    String normalizedSyn = normalizeMetricText(syn);
                    for (IndexEntry entry : allCandidates) {
                        if (entry.getStandardName() == null || entry.getSource() == null) {
                            continue;
                        }
                        if (normalizedSyn.equals(normalizeMetricText(entry.getStandardName()))) {
                            log.info("Synonym-inferred caliber source={} from '{}' → '{}' "
                                    + "matching standardName '{}' for question [{}]",
                                    entry.getSource(), word, syn, entry.getStandardName(),
                                    question.length() > 60 ? question.substring(0, 60) + "..." : question);
                            return entry.getSource();
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to infer source from synonyms: {}", e.getMessage());
        }
        return null;
    }

    /** 按 source 过滤候选指标列表。source 为 null 时返回原列表。 */
    private static List<IndexEntry> filterBySource(List<IndexEntry> entries, Integer source) {
        if (entries == null || source == null) {
            return entries;
        }
        return entries.stream()
                .filter(e -> Objects.equals(source, e.getSource()))
                .collect(Collectors.toList());
    }

    // ─── 混合检索精排（v3 新增） ──────────────────────────────────────

    /**
     * BM25 + 向量 RRF 融合精排，在现有候选集上叠加 BM25 分数并重新排名。
     * <p>调用时机：Agent 拿到 intentClassification.query_expansions 之后。
     */
    public static List<IndexEntry> hybridRerank(List<IndexEntry> candidates,
                                         String question,
                                         List<String> queryExpansions,
                                         ContentStore contentStore,
                                         String projectId,
                                         int topK,
                                         ai.dat.core.index.bm25.IndexBm25Index bm25Index) {
        if (candidates == null || candidates.isEmpty()) return Collections.emptyList();

        // 1. 从候选集中收集精确/软匹配 boost
        //    注：这里用 candidates 做匹配判断（已在 resolve() 中筛过），不再要求全量
        List<IndexEntry> exactHits = selectDeterministicMatches(question, candidates);
        List<IndexEntry> softHits  = selectSoftMatches(question, candidates);
        Set<String> exactNums = exactHits.stream()
                .map(IndexEntry::getIndexNumber).collect(Collectors.toSet());
        Set<String> softNums  = softHits.stream()
                .map(IndexEntry::getIndexNumber).collect(Collectors.toSet());

        // 2. 口径 filter
        Integer caliberSource = extractExplicitSource(question);

        // 3. 走向量召回（带 caliber filter）
        Map<String, Integer> vectorRanks = new LinkedHashMap<>();
        try {
            if (contentStore != null) {
                List<IndexEntry> vec;
                if (caliberSource != null) {
                    vec = contentStore.retrieveIndexEntries(projectId, question, 40, caliberSource);
                } else {
                    vec = contentStore.retrieveIndexEntries(projectId, question, 40);
                }
                if (vec != null) {
                    for (int i = 0; i < vec.size(); i++) {
                        vectorRanks.putIfAbsent(vec.get(i).getIndexNumber(), i);
                    }
                }
            }
        } catch (Exception ex) {
            log.warn("Vector retrieve in hybridRerank failed: {}", ex.getMessage());
        }

        // 4. 走 BM25 召回
        Map<String, Integer> bm25Ranks = new LinkedHashMap<>();
        try {
            if (bm25Index != null) {
                // 原始 query（权重 1.0）
                for (ai.dat.core.index.bm25.Bm25Hit hit : bm25Index.search(question, 40)) {
                    bm25Ranks.putIfAbsent(hit.indexNumber(), bm25Ranks.size());
                }
                // query_expansions（权重 0.3，不改变 rank 顺序但会得分加权——这里直接用低权重检索，
                // BM25 分数天然较低，RRF 按 rank 融合时 rank 较远影响小）
                if (queryExpansions != null) {
                    for (String exp : queryExpansions) {
                        for (ai.dat.core.index.bm25.Bm25Hit hit : bm25Index.search(exp, 40, 0.3)) {
                            bm25Ranks.putIfAbsent(hit.indexNumber(), bm25Ranks.size());
                        }
                    }
                }
            }
        } catch (Exception ex) {
            log.warn("BM25 retrieve in hybridRerank failed: {}", ex.getMessage());
        }

        // 5. RRF 融合 (k=60) + exact/soft boost
        Map<String, Double> rrfScores = new LinkedHashMap<>();
        LinkedHashSet<String> allNums = new LinkedHashSet<>();
        candidates.forEach(c -> { if (c != null && c.getIndexNumber() != null) allNums.add(c.getIndexNumber()); });
        allNums.addAll(vectorRanks.keySet());
        allNums.addAll(bm25Ranks.keySet());

        final Map<String, IndexEntry> lookup = new LinkedHashMap<>();
        for (IndexEntry e : candidates) {
            if (e != null && e.getIndexNumber() != null) {
                lookup.putIfAbsent(e.getIndexNumber(), e);
            }
        }
        // 将向量和 BM25 结果也加入 lookup（通过 indexNumber 反查 candidates 可能不全）
        for (String num : vectorRanks.keySet()) {
            lookup.computeIfAbsent(num, k -> IndexEntry.from(k, k, Collections.emptyList(), null, null));
        }
        for (String num : bm25Ranks.keySet()) {
            lookup.computeIfAbsent(num, k -> IndexEntry.from(k, k, Collections.emptyList(), null, null));
        }

        for (String idx : allNums) {
            double score = 0.0;
            Integer vRank = vectorRanks.get(idx);
            if (vRank != null) score += 1.0 / (60 + vRank);
            Integer bRank = bm25Ranks.get(idx);
            if (bRank != null) score += 1.0 / (60 + bRank);
            if (exactNums.contains(idx))       score += 0.10;
            else if (softNums.contains(idx))   score += 0.03;
            rrfScores.put(idx, score);
        }

        return rrfScores.entrySet().stream()
                .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                .limit(Math.max(topK, 10))
                .map(e -> lookup.get(e.getKey()))
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
    }

    private static List<String> buildIndexReferenceSummaries(List<IndexEntry> allEntries) {
        if (allEntries == null || allEntries.isEmpty()) {
            return Collections.emptyList();
        }
        Map<String, FamilySummary> families = new LinkedHashMap<>();
        for (IndexEntry entry : allEntries) {
            if (entry == null || entry.getStandardName() == null || entry.getStandardName().isBlank()) {
                continue;
            }
            String familyName = normalizeMetricText(entry.getStandardName());
            if (familyName.isBlank()) {
                familyName = entry.getStandardName();
            }
            final String familyKey = familyName;
            FamilySummary family = families.computeIfAbsent(familyKey, k -> new FamilySummary(familyKey));
            family.examples.add(entry.getStandardName());
            if (entry.getAliases() != null) {
                family.aliases.addAll(entry.getAliases());
            }
            String sourceLabel = sourceLabel(entry.getSource());
            if (sourceLabel != null) {
                family.sources.add(sourceLabel);
            }
            String note = extractNote(entry.getStandardName());
            if (note != null) {
                family.notes.add(note);
            }
        }
        List<String> out = new ArrayList<>(families.size());
        for (FamilySummary family : families.values()) {
            StringBuilder sb = new StringBuilder();
            sb.append("- family=").append(family.familyName);
            if (!family.sources.isEmpty()) {
                sb.append(" | sources=").append(String.join(", ", family.sources));
            }
            if (!family.notes.isEmpty()) {
                sb.append(" | notes=").append(String.join(", ", family.notes));
            }
            if (!family.aliases.isEmpty()) {
                sb.append(" | aliases=").append(String.join(", ", family.aliases.stream().limit(5).toList()));
            }
            if (!family.examples.isEmpty()) {
                sb.append(" | examples=").append(String.join(" / ", family.examples.stream().limit(3).toList()));
            }
            out.add(sb.toString());
        }
        return out;
    }

    private static String sourceLabel(Integer source) {
        if (source == null) return null;
        return switch (source) {
            case 1 -> "人行口径";
            case 2 -> "监管口径";
            case 3 -> "省联社口径";
            default -> null;
        };
    }

    private static String extractNote(String standardName) {
        if (standardName == null) {
            return null;
        }
        int l = standardName.indexOf('(');
        int r = standardName.lastIndexOf(')');
        if (l < 0 || r <= l) {
            return null;
        }
        String note = standardName.substring(l + 1, r).trim();
        if (note.isEmpty()) {
            return null;
        }
        if (note.equals("人行口径") || note.equals("人民银行口径")
                || note.equals("监管口径") || note.equals("银监口径")
                || note.equals("省联社口径")) {
            return null;
        }
        return note;
    }

    private static final class FamilySummary {
        private final String familyName;
        private final Set<String> sources = new LinkedHashSet<>();
        private final Set<String> notes = new LinkedHashSet<>();
        private final Set<String> aliases = new LinkedHashSet<>();
        private final Set<String> examples = new LinkedHashSet<>();

        private FamilySummary(String familyName) {
            this.familyName = familyName;
        }
    }

    // ─── 多口径分组(供 Agent 在 selected 之后回填用) ──────────────────

    /**
     * 把"被 LLM 选中的指标 standardName"在全量库内回填出同名其他口径条目,
     * 用作 SIMILAR_QUESTION 事件的 caliber_groups。
     *
     * <p>规则:仅当 standardName 至少出现 2 条(包含 selected 自己)才构成一组,
     * 一个 standardName 一个组,内部按 source asc nulls last 排序保证稳定。
     *
     * @param selectedNumbers LLM 选中的 indexNumber 集合,空则返回空列表
     * @param allEntries       项目全量指标
     */
    public static List<IndexCaliberGroup> resolveCaliberGroups(Set<String> selectedNumbers,
                                                                List<IndexEntry> allEntries) {
        if (selectedNumbers == null || selectedNumbers.isEmpty()
                || allEntries == null || allEntries.isEmpty()) {
            return Collections.emptyList();
        }
        // 选中条目对应的 standardName 集合(可能多个 selected 对应同一 standardName)
        Set<String> seedNames = allEntries.stream()
                .filter(e -> selectedNumbers.contains(e.getIndexNumber()))
                .map(IndexEntry::getStandardName)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        if (seedNames.isEmpty()) {
            return Collections.emptyList();
        }
        // 按 standardName 分组全量库
        Map<String, List<IndexEntry>> byName = allEntries.stream()
                .filter(e -> e.getStandardName() != null && seedNames.contains(e.getStandardName()))
                .collect(Collectors.groupingBy(IndexEntry::getStandardName, LinkedHashMap::new,
                        Collectors.toList()));
        List<IndexCaliberGroup> groups = new ArrayList<>();
        for (String name : seedNames) {
            List<IndexEntry> entries = byName.get(name);
            if (entries == null || entries.size() < 2) {
                continue;
            }
            // 按 source 稳定排序(null 排最后,便于前端展示 人行→银监→省联社→未知)
            entries.sort((a, b) -> {
                Integer sa = a.getSource();
                Integer sb = b.getSource();
                if (Objects.equals(sa, sb)) return 0;
                if (sa == null) return 1;
                if (sb == null) return -1;
                return sa.compareTo(sb);
            });
            groups.add(IndexCaliberGroup.builder()
                    .standardName(name)
                    .entries(entries)
                    .build());
        }
        return groups;
    }

    /**
     * 用问题原文对全量指标做确定性精确选择。
     * <p>目标不是替代 LLM，而是拦住“名字已经说得很明确”的场景：
     * 各项贷款余额(人行口径) / 各项存款余额(人行口径) / 保证金存款余额(对公) 这类请求
     * 不应该再交给长 prompt 的 LLM 去猜。
     *
     * <p>规则：
     * <ul>
     *   <li>统一全半角括号、空白、中文口径词后比较；</li>
     *   <li>若问题显式指定了口径(人行/监管/银监/省联社)，只保留对应 source；</li>
     *   <li>若未指定口径且同一基础名存在多个 source，返回全部 source 版本（不含 plain）。</li>
     * </ul>
     */
    public static List<IndexEntry> selectDeterministicMatches(String question, List<IndexEntry> allEntries) {
        if (question == null || question.isBlank() || allEntries == null || allEntries.isEmpty()) {
            return Collections.emptyList();
        }
        Integer explicitSource = extractExplicitSource(question);
        String normalizedQuestion = normalizeMetricText(question);
        if (normalizedQuestion.isBlank()) {
            return Collections.emptyList();
        }

        List<IndexEntry> standardNameMatches = allEntries.stream()
                .filter(Objects::nonNull)
                .filter(e -> normalizedQuestion.equals(normalizeMetricText(e.getStandardName())))
                .collect(Collectors.toList());
        if (!standardNameMatches.isEmpty()) {
            List<IndexEntry> selected = selectBySourcePreference(standardNameMatches, explicitSource);
            if (!selected.isEmpty()) {
                return selected;
            }
        }

        List<IndexEntry> aliasMatches = allEntries.stream()
                .filter(Objects::nonNull)
                .filter(e -> aliasTextMatches(normalizedQuestion, e))
                .collect(Collectors.toList());
        if (aliasMatches.isEmpty()) {
            return Collections.emptyList();
        }
        return selectBySourcePreference(aliasMatches, explicitSource);
    }

    private static List<IndexEntry> selectBySourcePreference(List<IndexEntry> matches, Integer explicitSource) {
        if (matches == null || matches.isEmpty()) {
            return Collections.emptyList();
        }
        if (explicitSource != null) {
            return matches.stream()
                    .filter(e -> Objects.equals(explicitSource, e.getSource()))
                    .collect(Collectors.toList());
        }
        boolean hasCalibered = matches.stream().anyMatch(e -> e.getSource() != null);
        if (!hasCalibered) {
            return matches;
        }
        List<IndexEntry> caliberedMatches = matches.stream()
                .filter(e -> e.getSource() != null)
                .collect(Collectors.toList());
        return caliberedMatches.isEmpty() ? Collections.emptyList() : caliberedMatches;
    }

    private static boolean aliasTextMatches(String normalizedQuestion, IndexEntry entry) {
        if (entry == null || entry.getAliases() == null) {
            return false;
        }
        for (String alias : entry.getAliases()) {
            if (normalizedQuestion.equals(normalizeMetricText(alias))) {
                return true;
            }
        }
        return false;
    }

    /**
     * 软匹配:问题去掉查询词/语气词后,与标准名/别名做双向包含匹配。
     * <p>命中时直接返回,不再混入向量结果。用于处理"查询贷款客户数车贷"→"贷款客户数(车贷)"
     * 这类确定性匹配因多余文字而失败、但语义上明确指向少数指标的场景。
     */

    private static List<IndexEntry> selectSoftMatches(String question, List<IndexEntry> allEntries) {
        if (question == null || question.isBlank() || allEntries == null || allEntries.isEmpty()) {
            return Collections.emptyList();
        }
        Integer explicitSource = extractExplicitSource(question);
        String stripped = stripQueryWords(question);
        if (stripped.isBlank()) {
            return Collections.emptyList();
        }
        String normalizedStripped = normalizeMetricText(stripped);
        if (normalizedStripped.isBlank()) {
            return Collections.emptyList();
        }
        // 去掉括号做包含匹配,使"贷款客户数车贷"能匹配"贷款客户数(车贷)"
        String strippedNoParens = normalizedStripped.replace("(", "").replace(")", "");

        List<IndexEntry> matches = new ArrayList<>();
        for (IndexEntry e : allEntries) {
            if (e == null || e.getStandardName() == null) {
                continue;
            }
            String normalizedName = normalizeMetricText(e.getStandardName());
            if (normalizedName.isBlank()) {
                continue;
            }
            String nameNoParens = normalizedName.replace("(", "").replace(")", "");

            if (nameNoParens.contains(strippedNoParens) || strippedNoParens.contains(nameNoParens)) {
                matches.add(e);
                continue;
            }
            // 字符重叠度兜底：contains 匹配不到但字符高度重叠时也视为命中
            // 例："各项存款总额" vs "各项存款余额" (共享 各/项/存/款/额 5字，重叠≥70%)
            if (charOverlapRatio(strippedNoParens, nameNoParens) >= 0.7) {
                matches.add(e);
                continue;
            }
            // 检查别名
            if (e.getAliases() != null) {
                for (String alias : e.getAliases()) {
                    if (alias == null) {
                        continue;
                    }
                    String aliasNoParens = normalizeMetricText(alias).replace("(", "").replace(")", "");
                    if (aliasNoParens.contains(strippedNoParens) || strippedNoParens.contains(aliasNoParens)) {
                        matches.add(e);
                        break;
                    }
                    if (charOverlapRatio(strippedNoParens, aliasNoParens) >= 0.7) {
                        matches.add(e);
                        break;
                    }
                }
            }
        }
        if (matches.isEmpty()) {
            return Collections.emptyList();
        }
        return selectBySourcePreference(matches, explicitSource);
    }

    /**
     * 去掉问题中的常见查询词/语气词,保留核心指标关键词。
     */
    private static String stripQueryWords(String question) {
        if (question == null) {
            return "";
        }
        return question
                .replaceAll("^(查询|帮我|麻烦|看下|看一下|查一下|给我|查|看看|帮我查询一下|帮我查一下|麻烦查一下|请问)\\s*", "")
                .replaceAll("\\s*(是多少|的数据|一下|吧|吗|呢|啊|的金额|的数据是多少|的指标)\\s*$", "")
                .trim();
    }

    private static Integer extractExplicitSource(String question) {
        String raw = Objects.requireNonNullElse(question, "");
        if (raw.contains("人行口径") || raw.contains("人民银行口径")) {
            return 1;
        }
        if (raw.contains("监管口径") || raw.contains("银监口径")) {
            return 2;
        }
        if (raw.contains("省联社口径") || raw.contains("省联社")) {
            return 3;
        }
        return null;
    }

    /**
     * 计算两个字符串的字符级重叠度。
     * <p>将较短字符串拆成单字集合，计算在较长字符串中出现的比例。
     * 例："各项存款总额"(6字) ∩ "各项存款余额"(6字) = {各,项,存,款,额} → 5/6 ≈ 83%。
     */
    private static double charOverlapRatio(String a, String b) {
        if (a == null || b == null || a.isEmpty() || b.isEmpty()) return 0.0;
        String shorter = a.length() <= b.length() ? a : b;
        int overlap = 0;
        for (int i = 0; i < shorter.length(); i++) {
            if (b.indexOf(shorter.charAt(i)) >= 0 || a.indexOf(shorter.charAt(i)) >= 0) {
                // 字符在另一方中存在
                char c = shorter.charAt(i);
                if (a.indexOf(c) >= 0 && b.indexOf(c) >= 0) {
                    overlap++;
                }
            }
        }
        return (double) overlap / shorter.length();
    }

    private static String normalizeMetricText(String text) {
        if (text == null) {
            return "";
        }
        String normalized = text
                .replace('（', '(')
                .replace('）', ')')
                .replace(" ", "")
                .replace("\t", "")
                .replace("\n", "")
                .replace("\r", "");
        normalized = normalized
                .replace("(人行口径)", "")
                .replace("(人民银行口径)", "")
                .replace("(监管口径)", "")
                .replace("(银监口径)", "")
                .replace("(省联社口径)", "")
                .replace("人行口径", "")
                .replace("人民银行口径", "")
                .replace("监管口径", "")
                .replace("银监口径", "")
                .replace("省联社口径", "");
        return normalized.trim();
    }

    /**
     * 用 selected 指标的 standardName 走向量召回拿"近邻指标"作为 similar_indices。
     * <p>调用方:DefaultAskdataAgent 在拿到 selected_index_numbers 后调用一次,空入参会安全降级。
     *
     * @param contentStore     可空,空则跳过向量召回返回空列表
     * @param projectId        项目 ID
     * @param selectedEntries  LLM 选中的指标
     * @param allEntries       全量指标,用于排除自己与已选中的同名分组(避免和 caliberGroups 重复)
     * @param topK             召回上限(每个 selected 走一次召回后合并去重)
     */
    public static List<IndexEntry> resolveSimilarIndices(ContentStore contentStore,
                                                          String projectId,
                                                          List<IndexEntry> selectedEntries,
                                                          List<IndexEntry> allEntries,
                                                          int topK) {
        if (contentStore == null || selectedEntries == null || selectedEntries.isEmpty() || topK <= 0) {
            return Collections.emptyList();
        }
        Set<String> excluded = new HashSet<>();
        Set<String> seedNames = new HashSet<>();
        for (IndexEntry e : selectedEntries) {
            excluded.add(e.getIndexNumber());
            if (e.getStandardName() != null) seedNames.add(e.getStandardName());
        }
        // 把 caliberGroups 已经覆盖的指标也排除,避免相似问事件双倍展示
        if (allEntries != null) {
            for (IndexEntry e : allEntries) {
                if (e.getStandardName() != null && seedNames.contains(e.getStandardName())) {
                    excluded.add(e.getIndexNumber());
                }
            }
        }
        Map<String, IndexEntry> dedup = new LinkedHashMap<>();
        for (IndexEntry seed : selectedEntries) {
            if (seed.getStandardName() == null) continue;
            try {
                List<IndexEntry> hits = contentStore.retrieveIndexEntries(
                        projectId, seed.getStandardName(), topK);
                if (hits == null) continue;
                for (IndexEntry h : hits) {
                    if (h == null || h.getIndexNumber() == null) continue;
                    if (excluded.contains(h.getIndexNumber())) continue;
                    // similar_indices 只保留同一基础名/同一问题族的细分项，
                    // 不把“各项存款余额”带出“各项贷款余额”这种仅向量相近但业务上易误导的指标。
                    String normalizedHit = normalizeMetricText(h.getStandardName());
                    boolean sameFamily = seedNames.stream()
                            .map(IndexContextResolver::normalizeMetricText)
                            .anyMatch(normalizedHit::equals);
                    if (!sameFamily) continue;
                    dedup.putIfAbsent(h.getIndexNumber(), h);
                }
            } catch (UnsupportedOperationException ignored) {
                // 向量库未配置,直接放弃 similar_indices
                return Collections.emptyList();
            } catch (Exception ex) {
                log.warn("Similar index retrieval for seed {} failed: {}", seed.getIndexNumber(), ex.getMessage());
            }
        }
        return new ArrayList<>(dedup.values());
    }

    // ─── 查询机构范围推导 ────────────────────────────────────────────────

    /**
     * 推导 RANKING 场景的层级标签。
     * <p>优先从问题文本中检测用户想查询的机构层级，否则按 orgCode 字母前缀推导：
     * <ul>
     *   <li>问题含"支行" → label=支行（使用 REGEXP '^[0-9]'）</li>
     *   <li>问题含"分行" → label=分行（使用 REGEXP '^[A-Z]'）</li>
     *   <li>否则按权限：管理行身份（字母前缀 orgCode） → 全行；普通支行 → 支行</li>
     * </ul>
     */
    private RankingScope detectRankingScope(String projectId, String orgCode,
                                              Set<String> accessible, OrgPermissionProvider permProvider,
                                              String question) {
        if (orgCode == null || orgCode.isEmpty()) {
            return RankingScope.none();
        }
        String label;
        if (question != null) {
            if (question.contains("支行")) {
                label = "支行";
            } else if (question.contains("分行")) {
                label = "分行";
            } else {
                label = isManagementOrgCode(orgCode) ? "全行" : "支行";
            }
        } else {
            label = isManagementOrgCode(orgCode) ? "全行" : "支行";
        }
        return new RankingScope(label);
    }

    private record RankingScope(String orgLevelLabel) {
        private static RankingScope none() {
            return new RankingScope(null);
        }
    }

    /**
     * 机构解析结果，包含选中的机构及其聚合模式。
     */
    public record OrgResolution(List<String> orgCodes,
                                 List<String> orgNames,
                                 List<IndexContext.OrgCandidate> candidates,
                                 IndexContext.OrgResolutionMode mode,
                                 IndexContext.OrgAggregationMode aggregationMode) {
        public static OrgResolution none() {
            return new OrgResolution(Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
                    IndexContext.OrgResolutionMode.DEFAULT_SCOPE, IndexContext.OrgAggregationMode.NONE);
        }

        /**
         * 未解析状态：只准备候选列表，等待 LLM 意图分类返回 selected_org_codes 后再填充。
         */
        public static OrgResolution unresolved(List<IndexContext.OrgCandidate> candidates) {
            return new OrgResolution(Collections.emptyList(), Collections.emptyList(), candidates,
                    IndexContext.OrgResolutionMode.DEFAULT_SCOPE, IndexContext.OrgAggregationMode.NONE);
        }
    }

    /**
     * 根据 LLM 意图分类返回的 selected_org_codes 构建最终的机构解析结果。
     * <p>调用方：DefaultAskdataAgent 在拿到 intentClassification.selected_org_codes 后调用。
     *
     * @param selectedOrgCodes LLM 从候选中选出的 org_code 列表
     * @param allCandidates    全部候选机构（来自 IndexContext.mentionedOrgCandidates）
     * @param question         用户问题，用于判断聚合模式
     * @param orgAggModeHint   意图分类 LLM 输出的聚合模式（null 时回退到正则匹配）
     * @return 完整的机构解析结果
     */
    /** Convenience: call without LLM hint (full keyword fallback). */
    public static OrgResolution resolveOrgSelection(List<String> selectedOrgCodes,
                                                     List<IndexContext.OrgCandidate> allCandidates,
                                                     String question) {
        return resolveOrgSelection(selectedOrgCodes, allCandidates, question, null, true);
    }

    /** With LLM-provided aggregation mode hint. */
    public static OrgResolution resolveOrgSelection(List<String> selectedOrgCodes,
                                                     List<IndexContext.OrgCandidate> allCandidates,
                                                     String question,
                                                     String orgAggModeHint) {
        return resolveOrgSelection(selectedOrgCodes, allCandidates, question, orgAggModeHint, true);
    }

    /**
     * 内部实现。
     */
    private static OrgResolution resolveOrgSelection(List<String> selectedOrgCodes,
                                                     List<IndexContext.OrgCandidate> allCandidates,
                                                     String question,
                                                     String orgAggModeHint,
                                                     boolean useHint) {
        if (selectedOrgCodes == null || selectedOrgCodes.isEmpty()) {
            return OrgResolution.none();
        }
        if (allCandidates == null || allCandidates.isEmpty()) {
            return OrgResolution.none();
        }
        Map<String, IndexContext.OrgCandidate> candidateMap = allCandidates.stream()
                .collect(Collectors.toMap(IndexContext.OrgCandidate::getOrgCode, c -> c, (a, b) -> a, LinkedHashMap::new));

        List<IndexContext.OrgCandidate> matched = new ArrayList<>();
        for (String code : selectedOrgCodes) {
            IndexContext.OrgCandidate candidate = candidateMap.get(code);
            if (candidate != null) {
                matched.add(candidate);
            }
        }
        if (matched.isEmpty()) {
            return OrgResolution.none();
        }
        List<String> orgCodes = matched.stream().map(IndexContext.OrgCandidate::getOrgCode).toList();
        List<String> orgNames = matched.stream().map(IndexContext.OrgCandidate::getOrgName).toList();
        boolean multi = orgCodes.size() > 1;

        if (multi) {
            IndexContext.OrgAggregationMode mode;

            // 优先使用意图分类 LLM 输出的模式提示（语义理解远优于关键词匹配）
            if (orgAggModeHint != null && !orgAggModeHint.isBlank()) {
                mode = switch (orgAggModeHint.toUpperCase().trim()) {
                    case "SUBTRACT" -> orgCodes.size() == 2
                            ? IndexContext.OrgAggregationMode.SUBTRACT
                            : IndexContext.OrgAggregationMode.GROUP_BY_ORG;
                    case "DIVIDE" -> orgCodes.size() == 2
                            ? IndexContext.OrgAggregationMode.DIVIDE
                            : IndexContext.OrgAggregationMode.GROUP_BY_ORG;
                    case "COMPARE" -> IndexContext.OrgAggregationMode.GROUP_BY_ORG;
                    case "SUM" -> IndexContext.OrgAggregationMode.SUM_CHILDREN;
                    default -> null;  // LLM 给了不认识的值，走正则回退
                };
                if (mode != null) {
                    return new OrgResolution(orgCodes, orgNames, matched,
                            IndexContext.OrgResolutionMode.MULTI_AGGREGATION, mode);
                }
            }

            // 回退到正则关键词匹配（LLM 未提供或未识别时）
            if (isSubtractionQuestion(question)) {
                if (orgCodes.size() == 2) {
                    mode = IndexContext.OrgAggregationMode.SUBTRACT;
                } else {
                    mode = IndexContext.OrgAggregationMode.GROUP_BY_ORG;
                }
            } else if (isDivisionQuestion(question)) {
                if (orgCodes.size() == 2) {
                    mode = IndexContext.OrgAggregationMode.DIVIDE;
                } else {
                    mode = IndexContext.OrgAggregationMode.GROUP_BY_ORG;
                }
            } else if (isComparisonQuestion(question)) {
                mode = IndexContext.OrgAggregationMode.GROUP_BY_ORG;
            } else if (isSumQuestion(question)) {
                mode = IndexContext.OrgAggregationMode.SUM_CHILDREN;
            } else {
                mode = IndexContext.OrgAggregationMode.UNCERTAIN;
            }

            return new OrgResolution(orgCodes, orgNames, matched,
                    IndexContext.OrgResolutionMode.MULTI_AGGREGATION, mode);
        }

        return new OrgResolution(orgCodes, orgNames, matched,
                IndexContext.OrgResolutionMode.SINGLE,
                IndexContext.OrgAggregationMode.NONE);
    }

    // 求差：覆盖"相差/差距/相减/求差/多出/高出/差多少"等常见表达
    private static final Pattern SUBTRACT_PATTERN = Pattern.compile(
            "相差|差距|相减|求差|减去|减掉|差值|差额|差多少|"
            + "多(了|出)多少|少(了|出)多少|高(了|出)多少|低(了|出)多少|"
            + "净增|净减|变化.*多少|变动.*多少|"
            + "比.{0,5}(多|少|高|低|大|小)(了|出)?多少|"
            + ".和.的(差|差值|差额)");

    // 求比：覆盖"占比/比例/除以/几倍/百分比"等
    private static final Pattern DIVIDE_PATTERN = Pattern.compile(
            "占比|占.{1,5}的比例|百分之几|百分比|"
            + "除以|除上|比上|"
            + "是.{1,5}的.{0,3}倍|相当于.{1,5}的.{0,3}倍|"
            + ".和.的(比|比率|比值)");

    // 分组对比：覆盖"分别/各自/对比/每个/分开/分行有/支行有"等
    private static final Pattern COMPARISON_PATTERN = Pattern.compile(
            "分别|各自|对比|比较|各.{0,2}的|每个|分开|"
            + "(分行|支行|部门|机构).{0,3}(分别|各自|各)");

    // 求和：覆盖"合计/总和/汇总/加总/累计/总计/相加/加起来/一共"
    private static final Pattern SUM_PATTERN = Pattern.compile(
            "总额|合计|总和|汇总|加总|累计|总计|相加|加起来|一共");

    private static boolean isSubtractionQuestion(String question) {
        return SUBTRACT_PATTERN.matcher(Objects.requireNonNullElse(question, "")).find();
    }

    private static boolean isDivisionQuestion(String question) {
        return DIVIDE_PATTERN.matcher(Objects.requireNonNullElse(question, "")).find();
    }

    private static boolean isComparisonQuestion(String question) {
        return COMPARISON_PATTERN.matcher(Objects.requireNonNullElse(question, "")).find();
    }

    private static boolean isSumQuestion(String question) {
        return SUM_PATTERN.matcher(Objects.requireNonNullElse(question, "")).find();
    }

    // ─── 查询类型识别 ────────────────────────────────────────────────────

    private QueryKind detectKind(String question, OrgResolution resolution) {
        if (RANKING_KEYWORDS.matcher(Objects.requireNonNullElse(question, "")).find()) {
            return QueryKind.RANKING;
        }
        if (resolution != null && resolution.mode() == IndexContext.OrgResolutionMode.MULTI_AGGREGATION) {
            return QueryKind.ORG_AGGREGATION;
        }
        return QueryKind.STANDARD;
    }
}
