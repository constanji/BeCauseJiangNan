package ai.dat.server.openapi.controller;

import ai.dat.project.datastore.document.GlobalConfigDocument;
import ai.dat.project.datastore.service.GlobalConfigService;
import ai.dat.server.openapi.dto.GlobalConfigRequest;
import ai.dat.server.openapi.dto.GlobalConfigResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * 全局配置管理接口
 *
 * @Author DAT Team
 * @Date 2026/06/16
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/config")
@Tag(name = "Global Configuration", description = "Global system configuration management")
public class GlobalConfigController {

    private final GlobalConfigService globalConfigService;

    @Autowired
    public GlobalConfigController(@Autowired(required = false) GlobalConfigService globalConfigService) {
        this.globalConfigService = globalConfigService;
    }

    @Operation(summary = "Get global configuration",
            description = "Retrieve current global configuration including default project and datasource")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Successful"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @GetMapping("/global")
    public ResponseEntity<GlobalConfigResponse> getGlobalConfig() {
        if (globalConfigService == null) {
            return ResponseEntity.status(503)
                    .body(GlobalConfigResponse.builder()
                            .build());
        }

        try {
            GlobalConfigDocument config = globalConfigService.getGlobalConfig();
            GlobalConfigResponse response = GlobalConfigResponse.builder()
                    .defaultProjectId(config.getDefaultProjectId())
                    .defaultDatasourceId(config.getDefaultDatasourceId())
                    .createdAt(config.getCreatedAt())
                    .updatedAt(config.getUpdatedAt())
                    .build();
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Failed to get global config: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    @Operation(summary = "Update global configuration",
            description = "Update default project and datasource configuration. " +
                    "When ask API (OpenAPI/ESB/MCP) does not provide project_id or datasource_id, " +
                    "these defaults will be used automatically.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Successfully updated"),
            @ApiResponse(responseCode = "400", description = "Invalid request"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @PutMapping("/global")
    public ResponseEntity<GlobalConfigResponse> updateGlobalConfig(
            @Valid @RequestBody GlobalConfigRequest request) {
        if (globalConfigService == null) {
            return ResponseEntity.status(503).build();
        }

        try {
            GlobalConfigDocument config = globalConfigService.updateDefaultProjectAndDatasource(
                    request.getDefaultProjectId(),
                    request.getDefaultDatasourceId());

            GlobalConfigResponse response = GlobalConfigResponse.builder()
                    .defaultProjectId(config.getDefaultProjectId())
                    .defaultDatasourceId(config.getDefaultDatasourceId())
                    .createdAt(config.getCreatedAt())
                    .updatedAt(config.getUpdatedAt())
                    .build();

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Failed to update global config: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }

    @Operation(summary = "Clear default configuration",
            description = "Clear default project and datasource configuration")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Successfully cleared"),
            @ApiResponse(responseCode = "500", description = "Internal server error")
    })
    @DeleteMapping("/global/defaults")
    public ResponseEntity<Void> clearDefaultConfig() {
        if (globalConfigService == null) {
            return ResponseEntity.status(503).build();
        }

        try {
            globalConfigService.clearDefaultConfig();
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("Failed to clear default config: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }
}
