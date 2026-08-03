package ai.dat.boot;

import ai.dat.boot.utils.ProjectUtil;
import ai.dat.core.configuration.ConfigOption;
import ai.dat.core.configuration.ReadableConfig;
import ai.dat.core.data.project.DatProject;
import ai.dat.core.factories.DatProjectFactory;
import ai.dat.core.utils.FactoryUtil;
import lombok.NonNull;
import lombok.extern.slf4j.Slf4j;

import java.nio.file.Path;
import java.util.*;

import static ai.dat.core.factories.DatProjectFactory.*;

/**
 * @Author JunjieM
 * @Date 2025/8/7
 */
@Slf4j
class PreBuildValidator {

    private final DatProject project;
    private final Path projectPath;
    private final Map<String, Object> variables;

    public PreBuildValidator(@NonNull DatProject project, @NonNull Path projectPath,
                             Map<String, Object> variables) {
        this.project = project;
        this.projectPath = projectPath;
        this.variables = Optional.ofNullable(variables).orElse(Collections.emptyMap());
    }

    public void validate() {
        ReadableConfig config = project.getConfiguration();
        DatProjectFactory factory = new DatProjectFactory();
        Set<ConfigOption<?>> requiredOptions = factory.projectRequiredOptions();
        Set<ConfigOption<?>> optionalOptions = factory.projectOptionalOptions();
        FactoryUtil.validateFactoryOptions(requiredOptions, optionalOptions, config);

        ProjectUtil.createDatabaseAdapter(project, projectPath);
    }

}
