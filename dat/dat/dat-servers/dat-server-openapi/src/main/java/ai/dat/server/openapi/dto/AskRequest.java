package ai.dat.server.openapi.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "Ask data request")
public class AskRequest {

    @Schema(name = "project_id",
            description = "Project ID. Frontend must select a project before chatting.",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("project_id")
    private String projectId;

    @Schema(name = "datasource_id",
            description = "Datasource ID for semantic model selection. Frontend must select a datasource under the project.",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("datasource_id")
    private String datasourceId;

    @Schema(name = "conversation_id",
            description = "Conversation ID, to continue the conversation based on previous chat records, " +
                    "it is necessary to pass the previous message's conversation_id.",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("conversation_id")
    private String conversationId;

    @Schema(name = "agent_name", description = "Agent name", defaultValue = "default",
            requiredMode = Schema.RequiredMode.AUTO)
    @JsonProperty("agent_name")
    private String agentName = "default";

    @NotBlank(message = "The question cannot be empty")
    @Schema(description = "User question", requiredMode = Schema.RequiredMode.REQUIRED)
    private String question;

    @Schema(name = "org_code",
            description = "User's org code for data permission. " +
                    "Required when the project has `index-ask: true`; ignored otherwise.",
            requiredMode = Schema.RequiredMode.NOT_REQUIRED)
    @JsonProperty("org_code")
    private String orgCode;
}
