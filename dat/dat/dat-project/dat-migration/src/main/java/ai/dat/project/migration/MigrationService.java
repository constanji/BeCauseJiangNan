package ai.dat.project.migration;

import ai.dat.boot.utils.ProjectUtil;
import ai.dat.core.data.project.DatProject;
import ai.dat.project.datastore.document.ProjectDocument;
import ai.dat.project.datastore.service.ProjectService;
import ai.dat.project.datasource.document.DatasourceDocument;
import ai.dat.project.datasource.service.DatasourceService;
import lombok.Data;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 数据迁移服务
 * 提供从文件配置迁移到 MongoDB 的工具
 * 
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MigrationService {

    private final ProjectService projectService;
    private final DatasourceService datasourceService;

    /**
     * 迁移结果
     */
    @Data
    public static class MigrationResult {
        private boolean success;
        private String projectId;
        private String datasourceId;
        private List<String> errors = new ArrayList<>();
        private List<String> warnings = new ArrayList<>();
    }

    /**
     * 从 dat_project.yaml 迁移项目到 MongoDB
     * 
     * @param projectPath 项目路径
     * @return 创建的项目文档
     */
    public ProjectDocument migrateProjectFromYaml(@NonNull Path projectPath) {
        log.info("Migrating project from: {}", projectPath);
        
        try {
            // 加载项目配置
            DatProject datProject = ProjectUtil.loadProject(projectPath);
            
            // 检查项目是否已存在
            if (projectService.getByName(datProject.getName()).isPresent()) {
                throw new IllegalStateException("Project with name '" + datProject.getName() + "' already exists in MongoDB");
            }
            
            // 创建项目文档
            ProjectDocument projectDoc = projectService.createFromDatProject(datProject);
            log.info("Project migrated successfully: {} -> {}", datProject.getName(), projectDoc.getId());
            
            return projectDoc;
        } catch (Exception e) {
            log.error("Failed to migrate project from: {}", projectPath, e);
            throw new RuntimeException("Project migration failed: " + e.getMessage(), e);
        }
    }

    /**
     * 完整项目迁移
     * 迁移项目配置、创建默认数据源、迁移语义模型
     * 
     * @param projectPath 项目路径
     * @return 迁移结果
     */
    public MigrationResult migrateProject(@NonNull Path projectPath) {
        MigrationResult result = new MigrationResult();
        
        log.info("Starting full project migration from: {}", projectPath);
        
        try {
            // 1. 迁移项目配置
            ProjectDocument projectDoc = migrateProjectFromYaml(projectPath);
            result.setProjectId(projectDoc.getId());
            
            // 2. 创建默认数据源（基于项目的数据库配置）
            DatProject datProject = projectService.toDatProject(projectDoc);
            DatasourceDocument datasourceDoc = datasourceService.create(
                    projectDoc.getId(),
                    "default",
                    "Default datasource migrated from project",
                    datProject.getDb() != null ? datProject.getDb().getProvider() : "unknown",
                    null  // 配置将从项目中继承
            );
            result.setDatasourceId(datasourceDoc.getId());
            
            result.setSuccess(true);
            log.info("Project migration completed successfully. Project ID: {}, Datasource ID: {}",
                    result.getProjectId(), result.getDatasourceId());
            
        } catch (Exception e) {
            result.setSuccess(false);
            result.getErrors().add(e.getMessage());
            log.error("Project migration failed", e);
        }
        
        return result;
    }

    /**
     * 验证迁移结果
     * 
     * @param result 迁移结果
     * @return 验证是否通过
     */
    public boolean validateMigration(@NonNull MigrationResult result) {
        if (!result.isSuccess()) {
            return false;
        }
        
        try {
            // 验证项目存在
            projectService.getById(result.getProjectId());
            
            // 验证数据源存在
            datasourceService.getById(result.getDatasourceId());
            
            log.info("Migration validation passed");
            return true;
        } catch (Exception e) {
            log.error("Migration validation failed", e);
            return false;
        }
    }

}
