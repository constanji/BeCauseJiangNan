package ai.dat.project.datasource.service;

import ai.dat.project.datasource.document.DatasourceDocument;
import ai.dat.project.datasource.repository.DatasourceRepository;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 数据源服务类
 * 提供数据源的 CRUD 操作
 * 
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Slf4j
@Service("datastoreDatasourceService")
@RequiredArgsConstructor
public class DatasourceService {

    private final DatasourceRepository datasourceRepository;

    /**
     * 创建数据源
     * 
     * @param projectId 项目ID
     * @param name 数据源名称
     * @param description 数据源描述
     * @param provider 提供者类型
     * @param configuration 配置
     * @return 创建的数据源文档
     */
    public DatasourceDocument create(@NonNull String projectId, 
                                      @NonNull String name,
                                      String description,
                                      @NonNull String provider,
                                      Map<String, Object> configuration) {
        if (datasourceRepository.existsByProjectIdAndName(projectId, name)) {
            throw new IllegalArgumentException(
                    "Datasource with name '" + name + "' already exists in project: " + projectId);
        }
        
        DatasourceDocument document = DatasourceDocument.builder()
                .projectId(projectId)
                .name(name)
                .description(description)
                .provider(provider)
                .configuration(configuration)
                .enabled(true)
                .createdAt(LocalDateTime.now())
                .updatedAt(LocalDateTime.now())
                .build();
        
        return datasourceRepository.save(document);
    }

    /**
     * 查询所有数据源
     * 
     * @return 数据源列表
     */
    public List<DatasourceDocument> listAll() {
        return datasourceRepository.findAll();
    }

    /**
     * 更新数据源（直接使用文档对象）
     * 
     * @param document 更新的数据源文档
     * @return 更新后的数据源文档
     */
    public DatasourceDocument update(@NonNull DatasourceDocument document) {
        DatasourceDocument existing = getById(document.getId());
        document.setCreatedAt(existing.getCreatedAt());
        document.setUpdatedAt(LocalDateTime.now());
        return datasourceRepository.save(document);
    }

    /**
     * 根据ID查询数据源
     * 
     * @param datasourceId 数据源ID
     * @return 数据源文档
     */
    public DatasourceDocument getById(@NonNull String datasourceId) {
        return datasourceRepository.findById(datasourceId)
                .orElseThrow(() -> new IllegalArgumentException("Datasource not found: " + datasourceId));
    }

    /**
     * 根据项目ID和名称查询数据源
     * 
     * @param projectId 项目ID
     * @param name 数据源名称
     * @return 数据源文档
     */
    public Optional<DatasourceDocument> getByProjectIdAndName(@NonNull String projectId, @NonNull String name) {
        return datasourceRepository.findByProjectIdAndName(projectId, name);
    }

    /**
     * 查询项目下所有数据源
     * 
     * @param projectId 项目ID
     * @return 数据源列表
     */
    public List<DatasourceDocument> listByProjectId(@NonNull String projectId) {
        return datasourceRepository.findByProjectId(projectId);
    }

    /**
     * 查询项目下所有启用的数据源
     * 
     * @param projectId 项目ID
     * @return 启用的数据源列表
     */
    public List<DatasourceDocument> listEnabledByProjectId(@NonNull String projectId) {
        return datasourceRepository.findByProjectIdAndEnabledTrue(projectId);
    }

    /**
     * 更新数据源
     * 
     * @param datasourceId 数据源ID
     * @param name 数据源名称
     * @param description 数据源描述
     * @param provider 提供者类型
     * @param configuration 配置
     * @return 更新后的数据源文档
     */
    public DatasourceDocument update(@NonNull String datasourceId,
                                      String name,
                                      String description,
                                      String provider,
                                      Map<String, Object> configuration) {
        DatasourceDocument existing = getById(datasourceId);
        
        if (name != null && !name.equals(existing.getName())) {
            // 检查新名称是否已存在
            if (datasourceRepository.existsByProjectIdAndName(existing.getProjectId(), name)) {
                throw new IllegalArgumentException(
                        "Datasource with name '" + name + "' already exists in project: " + existing.getProjectId());
            }
            existing.setName(name);
        }
        
        if (description != null) {
            existing.setDescription(description);
        }
        
        if (provider != null) {
            existing.setProvider(provider);
        }
        
        if (configuration != null) {
            existing.setConfiguration(configuration);
        }
        
        existing.setUpdatedAt(LocalDateTime.now());
        
        return datasourceRepository.save(existing);
    }

    /**
     * 启用/禁用数据源
     * 
     * @param datasourceId 数据源ID
     * @param enabled 是否启用
     * @return 更新后的数据源文档
     */
    public DatasourceDocument setEnabled(@NonNull String datasourceId, boolean enabled) {
        DatasourceDocument existing = getById(datasourceId);
        existing.setEnabled(enabled);
        existing.setUpdatedAt(LocalDateTime.now());
        return datasourceRepository.save(existing);
    }

    /**
     * 删除数据源
     * 
     * @param datasourceId 数据源ID
     */
    public void delete(@NonNull String datasourceId) {
        if (!datasourceRepository.existsById(datasourceId)) {
            throw new IllegalArgumentException("Datasource not found: " + datasourceId);
        }
        datasourceRepository.deleteById(datasourceId);
    }

    /**
     * 删除项目下所有数据源
     * 
     * @param projectId 项目ID
     */
    public void deleteByProjectId(@NonNull String projectId) {
        datasourceRepository.deleteByProjectId(projectId);
    }

}
