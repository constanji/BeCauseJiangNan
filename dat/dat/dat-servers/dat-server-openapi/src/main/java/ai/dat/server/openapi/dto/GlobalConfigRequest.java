package ai.dat.server.openapi.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 全局配置请求
 *
 * @Author DAT Team
 * @Date 2026/06/16
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "Global configuration request")
public class GlobalConfigRequest {

    @Schema(name = "default_project_id",
            description = "Default project ID. Used when ask API does not provide project_id. " +
                    "Set to null to clear.",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("default_project_id")
    private String defaultProjectId;

    @Schema(name = "default_datasource_id",
            description = "Default datasource ID. Used when ask API does not provide datasource_id. " +
                    "Set to null to clear.",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("default_datasource_id")
    private String defaultDatasourceId;
}
