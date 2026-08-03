package ai.dat.boot;

import ai.dat.boot.data.FileChanges;
import ai.dat.boot.data.RelevantFileState;
import ai.dat.boot.data.SchemaFileState;
import ai.dat.boot.utils.FileUtil;
import ai.dat.boot.utils.ProjectUtil;
import ai.dat.core.data.DatModel;
import ai.dat.core.data.DatSchema;
import ai.dat.core.data.example.Example;
import ai.dat.core.data.project.DatProject;
import ai.dat.core.exception.ValidationException;
import ai.dat.core.utils.DatSchemaUtil;
import com.google.common.base.Preconditions;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 文件变化分析器
 *
 * @Author JunjieM
 * @Date 2025/7/17
 */
@Slf4j
class FileChangeAnalyzer {

    private final Path modelsPath;

    private final DatProject project;

    private final List<Path> yamlFilePaths;
    private final List<Path> sqlFilePaths;
    private final List<String> sqlFileRelativePaths;

    public FileChangeAnalyzer(DatProject project,
                              Path projectPath) {
        this.project = project;
        this.modelsPath = projectPath.resolve(ProjectUtil.MODELS_DIR_NAME);
        this.yamlFilePaths = ProjectUtil.scanYamlFiles(modelsPath);
        this.sqlFilePaths = ProjectUtil.scanSqlFiles(modelsPath);
        this.sqlFileRelativePaths = sqlFilePaths.stream()
                .map(p -> modelsPath.relativize(p).toString())
                .collect(Collectors.toList());
    }

    public FileChanges analyzeChanges(List<SchemaFileState> fileStates) {

        Map<String, SchemaFileState> fileStateMap = fileStates.stream()
                .collect(Collectors.toMap(SchemaFileState::getRelativePath, Function.identity()));

        List<SchemaFileState> newFiles = new ArrayList<>();
        List<SchemaFileState> modifiedFiles = new ArrayList<>();
        List<SchemaFileState> unchangedFiles = new ArrayList<>();

        // 分析当前存在的文件
        for (Path filePath : yamlFilePaths) {
            String relativePath = modelsPath.relativize(filePath).toString();
            SchemaFileState fileState = fileStateMap.get(relativePath);
            if (fileState == null) {
                // 新YAML文件
                long lastModified = FileUtil.lastModified(filePath);
                String md5Hash = FileUtil.md5(filePath);
                DatSchema schema = ProjectUtil.loadSchema(filePath, modelsPath);
                newFiles.add(createSchemaFileState(
                        relativePath, lastModified, md5Hash, schema));
            } else {
                // 已存在的YAML文件，检查是否发生变化
                boolean hasChanged = false;
                String md5Hash = null;
                long lastModified = FileUtil.lastModified(filePath);
                if (lastModified - fileState.getLastModified() > 0) {
                    md5Hash = FileUtil.md5(filePath);
                    hasChanged = !md5Hash.equals(fileState.getMd5Hash());
                }
                if (hasChanged) {
                    // YAML文件已修改
                    DatSchema schema = ProjectUtil.loadSchema(filePath, modelsPath);
                    modifiedFiles.add(createSchemaFileState(
                            relativePath, lastModified, md5Hash, schema));
                } else {
                    // YAML文件未变化，保留之前的元数据
                    unchangedFiles.add(fileState);
                }
            }
        }

        // 查找已删除的YAML文件 - 直接内联处理逻辑
        List<String> relativePaths = yamlFilePaths.stream()
                .map(p -> modelsPath.relativize(p).toString()).toList();
        List<SchemaFileState> deletedFiles = fileStates.stream()
                .filter(p -> !relativePaths.contains(p.getRelativePath()))
                .collect(Collectors.toList());

        return new FileChanges(newFiles, modifiedFiles, unchangedFiles, deletedFiles);
    }

    private SchemaFileState createSchemaFileState(String relativePath, long lastModified, String md5Hash,
                                                  DatSchema schema) {
        Example example = schema.getExample();
        if (example != null) {
            ChangeQuestionSqlPairsCacheUtil.add(project.getName(), relativePath,
                    example.getQuestionSqlPairs());
            ChangeWordSynonymPairsCacheUtil.add(project.getName(), relativePath,
                    example.getWordSynonymPairs());
            ChangeKnowledgeCacheUtil.add(project.getName(), relativePath,
                    example.getKnowledge());
        }
        return SchemaFileState.builder()
                .relativePath(relativePath)
                .lastModified(lastModified)
                .md5Hash(md5Hash)
                .build();
    }

}