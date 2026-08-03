package ai.dat.server.openapi.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 全局配置响应
 *
 * @Author DAT Team
 * @Date 2026/06/16
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "Global configuration response")
public class GlobalConfigResponse {

    @Schema(name = "default_project_id",
            description = "Default project ID",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("default_project_id")
    private String defaultProjectId;

    @Schema(name = "default_datasource_id",
            description = "Default datasource ID",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("default_datasource_id")
    private String defaultDatasourceId;

    @Schema(name = "created_at",
            description = "Configuration created time",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("created_at")
    private LocalDateTime createdAt;

    @Schema(name = "updated_at",
            description = "Configuration last updated time",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("updated_at")
    private LocalDateTime updatedAt;
}
