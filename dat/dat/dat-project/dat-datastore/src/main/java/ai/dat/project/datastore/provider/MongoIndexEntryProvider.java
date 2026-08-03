package ai.dat.project.datastore.provider;

import ai.dat.core.contentstore.data.IndexEntry;
import ai.dat.core.index.provider.IndexEntryProvider;
import ai.dat.project.datastore.document.IndexEntryDocument;
import ai.dat.project.datastore.repository.IndexEntryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 基于 MongoDB 的指标候选检索实现。
 * <p>
 * 只负责"精确路径"召回 —— 按标准名/别名做子串匹配。向量路径召回放在
 * {@code IndexContextResolver} 编排器里直接调 {@code ContentStore.retrieveIndexEntries},
 * 这样 provider 不必持有 {@code ContentStore}(ContentStore 是 conversation 维度的 bean,
 * provider 是应用级 bean,职责分开)。
 *
 * <h3>精确匹配规则</h3>
 * <ul>
 *   <li>对问题原文做最简化处理(不分词);</li>
 *   <li>遍历项目全部指标(Mongo 端 findByProjectId,内存里走子串比对);</li>
 *   <li>问题 包含 标准名 或 别名 → 命中;</li>
 *   <li>命中后按 indexNumber 去重,标准名命中优先 -> 别名命中次之。</li>
 * </ul>
 *
 * <p>当一个项目的指标条目超过 5K 后再考虑加 Mongo 端 regex 索引;当前规模(银行
 * 业务指标通常 50-500 条)内存子串足够快。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MongoIndexEntryProvider implements IndexEntryProvider {

    private final IndexEntryRepository repo;

    @Override
    public List<IndexEntry> retrieve(String projectId, String question) {
        if (projectId == null || projectId.isEmpty() || question == null || question.isBlank()) {
            return Collections.emptyList();
        }
        List<IndexEntryDocument> all = repo.findByProjectId(projectId);
        if (all.isEmpty()) {
            return Collections.emptyList();
        }
        // 按 indexNumber 去重,保留首次命中的顺序(标准名命中优先)
        Map<String, IndexEntry> hits = new LinkedHashMap<>();
        // 第一轮:标准名命中
        for (IndexEntryDocument doc : all) {
            if (doc.getStandardName() != null && question.contains(doc.getStandardName())) {
                hits.putIfAbsent(doc.getIndexNumber(), toEntry(doc));
            }
        }
        // 第二轮:别名命中
        for (IndexEntryDocument doc : all) {
            if (doc.getAliases() == null) continue;
            for (String alias : doc.getAliases()) {
                if (alias != null && !alias.isEmpty() && question.contains(alias)) {
                    hits.putIfAbsent(doc.getIndexNumber(), toEntry(doc));
                    break;
                }
            }
        }
        return new ArrayList<>(hits.values());
    }

    @Override
    public List<IndexEntry> listAll(String projectId) {
        if (projectId == null || projectId.isEmpty()) {
            return Collections.emptyList();
        }
        List<IndexEntryDocument> all = repo.findByProjectId(projectId);
        if (all.isEmpty()) {
            return Collections.emptyList();
        }
        List<IndexEntry> out = new ArrayList<>(all.size());
        for (IndexEntryDocument doc : all) {
            if (doc.getIndexNumber() == null || doc.getIndexNumber().isEmpty()
                    || doc.getStandardName() == null || doc.getStandardName().isEmpty()) {
                continue;
            }
            out.add(toEntry(doc));
        }
        return out;
    }

    private static IndexEntry toEntry(IndexEntryDocument doc) {
        return IndexEntry.from(
                doc.getIndexNumber(),
                doc.getStandardName(),
                doc.getAliases(),
                doc.getSource(),
                doc.getFrequency());
    }
}
