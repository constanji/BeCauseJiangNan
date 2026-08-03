package ai.dat.server.openapi.controller;

import ai.dat.core.data.project.DatProject;
import ai.dat.project.datastore.document.ProjectDocument;
import ai.dat.project.datastore.service.ProjectService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 项目管理 API
 * 仅在 MongoDB 模式下可用
 *
 * @Author DAT Team
 * @Date 2025/12/22
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/projects")
@Tag(name = "项目管理", description = "项目的增删改查接口")
@ConditionalOnProperty(prefix = "dat.server", name = "mode", havingValue = "mongodb")
public class ProjectController {

    private final ProjectService projectService;
    private final ai.dat.server.openapi.service.ProjectService projectRunnerService;

    @Autowired
    public ProjectController(
            @Qualifier("datastoreProjectService") ProjectService projectService,
            ai.dat.server.openapi.service.ProjectService projectRunnerService) {
        this.projectService = projectService;
        this.projectRunnerService = projectRunnerService;
    }

    @GetMapping
    @Operation(summary = "获取项目列表")
    public ResponseEntity<List<ProjectDocument>> list() {
        List<ProjectDocument> projects = projectService.listAll();
        return ResponseEntity.ok(projects);
    }

    @GetMapping("/{id}")
    @Operation(summary = "获取项目详情")
    public ResponseEntity<ProjectDocument> getById(@PathVariable("id") String id) {
        ProjectDocument project = projectService.getById(id);
        return ResponseEntity.ok(project);
    }

    @PostMapping
    @Operation(summary = "创建项目")
    public ResponseEntity<ProjectDocument> create(@RequestBody ProjectDocument project) {
        ProjectDocument created = projectService.create(project);
        return ResponseEntity.ok(created);
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新项目")
    public ResponseEntity<ProjectDocument> update(@PathVariable("id") String id, @RequestBody ProjectDocument project) {
        project.setId(id);
        ProjectDocument updated = projectService.update(id, project);
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除项目")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable("id") String id) {
        projectService.delete(id);
        return ResponseEntity.ok(Map.of("success", true, "message", "Project deleted successfully"));
    }

    @GetMapping("/{id}/config")
    @Operation(summary = "获取项目配置（转换为 DatProject 格式）")
    public ResponseEntity<DatProject> getConfig(@PathVariable("id") String id) {
        ProjectDocument projectDoc = projectService.getById(id);
        DatProject datProject = projectService.toDatProject(projectDoc);
        return ResponseEntity.ok(datProject);
    }

    @PostMapping("/{id}/refresh")
    @Operation(summary = "刷新项目缓存", description = "清除项目缓存，下次请求时重新加载配置")
    public ResponseEntity<Map<String, Object>> refresh(@PathVariable("id") String id) {
        projectRunnerService.refreshProject(id);
        return ResponseEntity.ok(Map.of("success", true, "message", "Project cache refreshed for project: " + id));
    }

    @PostMapping("/refresh-all")
    @Operation(summary = "刷新所有项目缓存", description = "清除所有项目缓存，下次请求时重新加载配置")
    public ResponseEntity<Map<String, Object>> refreshAll() {
        projectRunnerService.refreshAllProjects();
        return ResponseEntity.ok(Map.of("success", true, "message", "All project caches refreshed"));
    }
}
