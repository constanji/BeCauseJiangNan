package ai.dat.project.datastore.service;

import ai.dat.core.contentstore.data.IndexEntry;
import ai.dat.core.contentstore.data.IndexEntryWithId;
import ai.dat.project.datastore.document.IndexEntryDocument;
import ai.dat.project.datastore.repository.IndexEntryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 指标库持久化服务。
 * <p>
 * 数据按 {@code projectId} 隔离;{@code (projectId, indexNumber)} 在 Mongo 端有唯一索引。
 * upsert 会复用原文档 {@code _id},仅覆盖业务字段并刷新 {@code updatedAt}。
 *
 * @Author DAT Team
 * @Date 2026/6/5
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IndexEntryPersistenceService {

    private final IndexEntryRepository repo;

    // ─── upsert ──────────────────────────────────────────────────────────

    /**
     * 批量 upsert 指标条目。空集合或 null 直接返回空列表,不访问 Mongo。
     *
     * @return 落库后的 {@link IndexEntryDocument} 列表(包含 _id),顺序与入参一致。
     */
    public List<IndexEntryDocument> upsertAll(String projectId, List<IndexEntry> entries) {
        if (entries == null || entries.isEmpty()) {
            return Collections.emptyList();
        }
        // 1. 一次性查出本批次涉及的已存在文档,避免 N 次往返
        List<String> incomingNumbers = entries.stream()
                .map(IndexEntry::getIndexNumber)
                .collect(Collectors.toList());
        Map<String, IndexEntryDocument> existingByNumber = new HashMap<>();
        for (IndexEntryDocument doc : repo.findByProjectIdAndIndexNumberIn(projectId, incomingNumbers)) {
            existingByNumber.put(doc.getIndexNumber(), doc);
        }
        // 2. 构造待写入文档列表:已存在则复用 _id,否则 _id 为 null 让 Mongo 自动生成
        Instant now = Instant.now();
        List<IndexEntryDocument> toSave = entries.stream()
                .map(e -> {
                    IndexEntryDocument existing = existingByNumber.get(e.getIndexNumber());
                    return IndexEntryDocument.builder()
                            .id(existing != null ? existing.getId() : null)
                            .projectId(projectId)
                            .indexNumber(e.getIndexNumber())
                            .standardName(e.getStandardName())
                            .aliases(e.getAliases())
                            .source(e.getSource())
                            .frequency(e.getFrequency())
                            .updatedAt(now)
                            .build();
                })
                .collect(Collectors.toList());
        return repo.saveAll(toSave);
    }

    /** 单条 upsert,返回落库后的 {@code _id}。 */
    public String upsert(String projectId, IndexEntry entry) {
        List<IndexEntryDocument> saved = upsertAll(projectId, List.of(entry));
        return saved.isEmpty() ? null : saved.get(0).getId();
    }

    // ─── list / count ────────────────────────────────────────────────────

    /** 列出项目下全部指标(纯领域对象,无 _id)。过滤掉 indexNumber 为空的脏数据。 */
    public List<IndexEntry> listAll(String projectId) {
        return repo.findByProjectId(projectId).stream()
                .filter(IndexEntryPersistenceService::hasValidKeys)
                .map(IndexEntryPersistenceService::toEntry)
                .collect(Collectors.toList());
    }

    /** 列出项目下全部指标,带 _id,供前端 CRUD 用。过滤掉 indexNumber 为空的脏数据。 */
    public List<IndexEntryWithId> listAllWithId(String projectId) {
        return repo.findByProjectId(projectId).stream()
                .filter(IndexEntryPersistenceService::hasValidKeys)
                .map(doc -> IndexEntryWithId.from(doc.getId(), toEntry(doc)))
                .collect(Collectors.toList());
    }

    /**
     * 校验文档的必填字段是否完整。
     * <p>{@link IndexEntry} 用 @NonNull 卡了 indexNumber/standardName;Mongo 里历史
     * 脏数据或上传脚本异常可能产生 null 字段,直接 map 会抛 NPE 让整个列表接口挂掉。
     * 这里在 stream 里 filter 掉这种 doc,接口降级返回剩余有效条目而不是 500。
     */
    private static boolean hasValidKeys(IndexEntryDocument doc) {
        return doc.getIndexNumber() != null && !doc.getIndexNumber().isEmpty()
                && doc.getStandardName() != null && !doc.getStandardName().isEmpty();
    }

    public long countByProjectId(String projectId) {
        return repo.countByProjectId(projectId);
    }

    // ─── delete ──────────────────────────────────────────────────────────

    public void removeById(String id) {
        repo.deleteById(id);
    }

    public void removeAll(String projectId) {
        repo.deleteByProjectId(projectId);
    }

    /** 按 indexNumber 集合删除;空/null 视为 noop,不访问 Mongo。 */
    public void removeByIndexNumbers(String projectId, Collection<String> indexNumbers) {
        if (indexNumbers == null || indexNumbers.isEmpty()) {
            return;
        }
        repo.deleteByProjectIdAndIndexNumberIn(projectId, indexNumbers);
    }

    // ─── helper ──────────────────────────────────────────────────────────

    private static IndexEntry toEntry(IndexEntryDocument doc) {
        return IndexEntry.from(
                doc.getIndexNumber(),
                doc.getStandardName(),
                doc.getAliases(),
                doc.getSource(),
                doc.getFrequency());
    }
}
