package ai.dat.project.datastore.service;

import ai.dat.project.datastore.document.GlobalConfigDocument;
import ai.dat.project.datastore.repository.GlobalConfigRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 全局配置服务
 *
 * @Author DAT Team
 * @Date 2026/06/16
 */
@Slf4j
@Service
public class GlobalConfigService {

    private static final String GLOBAL_CONFIG_ID = "global";

    private final GlobalConfigRepository repository;

    @Autowired
    public GlobalConfigService(GlobalConfigRepository repository) {
        this.repository = repository;
    }

    /**
     * 获取全局配置（不存在时返回空配置）
     */
    public GlobalConfigDocument getGlobalConfig() {
        return repository.findById(GLOBAL_CONFIG_ID)
                .orElseGet(() -> {
                    log.info("Global config not found, returning default empty config");
                    return GlobalConfigDocument.builder()
                            .id(GLOBAL_CONFIG_ID)
                            .build();
                });
    }

    /**
     * 更新默认项目和数据源配置
     */
    public GlobalConfigDocument updateDefaultProjectAndDatasource(String projectId, String datasourceId) {
        GlobalConfigDocument config = repository.findById(GLOBAL_CONFIG_ID)
                .orElseGet(() -> {
                    log.info("Creating new global config");
                    GlobalConfigDocument newConfig = new GlobalConfigDocument();
                    newConfig.setId(GLOBAL_CONFIG_ID);
                    newConfig.setCreatedAt(LocalDateTime.now());
                    return newConfig;
                });

        config.setDefaultProjectId(projectId);
        config.setDefaultDatasourceId(datasourceId);
        config.setUpdatedAt(LocalDateTime.now());

        GlobalConfigDocument saved = repository.save(config);
        log.info("Updated global config: default_project_id={}, default_datasource_id={}",
                projectId, datasourceId);
        return saved;
    }

    /**
     * 清除默认配置
     */
    public void clearDefaultConfig() {
        Optional<GlobalConfigDocument> config = repository.findById(GLOBAL_CONFIG_ID);
        if (config.isPresent()) {
            GlobalConfigDocument doc = config.get();
            doc.setDefaultProjectId(null);
            doc.setDefaultDatasourceId(null);
            doc.setUpdatedAt(LocalDateTime.now());
            repository.save(doc);
            log.info("Cleared default project and datasource config");
        }
    }
}
