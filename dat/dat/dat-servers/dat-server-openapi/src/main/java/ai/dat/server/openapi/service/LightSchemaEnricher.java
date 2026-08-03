package ai.dat.server.openapi.service;

import ai.dat.core.contentstore.data.LightSchema;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import dev.langchain4j.service.V;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 使用 LLM 为 Light Schema 生成缺失的描述
 * 
 * @Author DAT Team
 * @Date 2026/1/7
 */
@Slf4j
@Service
public class LightSchemaEnricher {

    private final EnricherAssistant assistant;

    @Autowired
    public LightSchemaEnricher(@Autowired(required = false) ChatModel chatModel) {
        if (chatModel != null) {
            this.assistant = AiServices.builder(EnricherAssistant.class)
                    .chatModel(chatModel)
                    .build();
        } else {
            this.assistant = null;
            log.warn("ChatModel not found, LightSchemaEnricher enrichment will be disabled");
        }
    }

    /**
     * 为一组 Light Schema 补充描述 (优化版)
     */
    public void enrich(List<LightSchema> schemas) {
        log.info("Enriching {} light schemas", schemas.size());
        
        for (LightSchema schema : schemas) {
            // 首先通过规则快速生成基础描述 (基于 Python generate_fallback_description 逻辑)
            if (schema.getTableDescription() == null || schema.getTableDescription().isBlank()) {
                schema.setTableDescription(generateRuleBasedDescription(schema));
            }

            // 只有当提供了 AI 助手且表名看起来像是核心业务表时（或作为二次增强），才使用 AI
            // 默认情况下，规则生成的描述已经足够分词和搜索。
            /*
            if (assistant != null && (schema.getColumns().size() > 2)) {
                // 如果需要更高质量的 AI 增强，可以异步或批量进行
                // 目前先保留单表 AI 增强的接口，但不在此处阻塞式循环调用
            }
            */
        }
    }

    /**
     * 基于规则生成描述 (参考 Python generate_fallback_description)
     */
    private String generateRuleBasedDescription(LightSchema schema) {
        StringBuilder parts = new StringBuilder();
        parts.append("表 ").append(schema.getTableName());

        // 核心字段
        List<String> colNames = schema.getColumns().stream()
                .limit(5)
                .map(c -> {
                    if (schema.getPrimaryKeys() != null && schema.getPrimaryKeys().contains(c.getName())) {
                        return c.getName() + "(PK)";
                    }
                    return c.getName();
                })
                .collect(Collectors.toList());

        parts.append("。包含字段: ").append(String.join(", ", colNames));
        if (schema.getColumns().size() > 5) {
            parts.append(" 等共 ").append(schema.getColumns().size()).append(" 列");
        }

        // 外键关系
        if (schema.getForeignKeys() != null && !schema.getForeignKeys().isEmpty()) {
            List<String> fkTables = schema.getForeignKeys().stream()
                    .map(LightSchema.ForeignKey::getReferencedTable)
                    .distinct()
                    .collect(Collectors.toList());
            if (!fkTables.isEmpty()) {
                parts.append("。关联: ").append(String.join(", ", fkTables));
            }
        }

        return parts.append("。").toString();
    }

    /**
     * 为单张表补充描述
     */
    public void enrichSchema(LightSchema schema) {
        if (assistant == null) return;

        // 构建上下文：表名 + 列名 + 类型 + 采样值
        String columnsJson = schema.getColumns().stream()
                .map(c -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("name", c.getName());
                    map.put("type", c.getType());
                    map.put("samples", c.getSampleValues());
                    return map.toString();
                })
                .collect(Collectors.joining(", ", "[", "]"));

        log.info("Calling AI to generate descriptions for table: {}", schema.getTableName());
        EnrichedDescriptions results = assistant.generateDescriptions(schema.getTableName(), columnsJson);
        
        if (results != null) {
            if (schema.getTableDescription() == null || schema.getTableDescription().isBlank()) {
                schema.setTableDescription(results.getTableDescription());
            }
            
            for (LightSchema.ColumnInfo col : schema.getColumns()) {
                if (col.getDescription() == null || col.getDescription().isBlank()) {
                    if (results.getColumnDescriptions() != null && results.getColumnDescriptions().containsKey(col.getName())) {
                        col.setDescription(results.getColumnDescriptions().get(col.getName()));
                    }
                }
            }
            log.info("Successfully enriched table: {}", schema.getTableName());
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class EnrichedDescriptions {
        private String tableDescription;
        private Map<String, String> columnDescriptions;
    }

    interface EnricherAssistant {
        @SystemMessage("你是一个资深的数据库架构师和数据分析师。根据给定的表名、列信息（类型和采样值），为表和每个列生成专业、简洁的中文描述。这些描述将用于辅助 LLM 生成 SQL 语句，因此需要准确反映数据的业务含义。")
        @UserMessage("请为以下表生成描述：\n" +
                "表名: {{tableName}}\n" +
                "列信息与采样: {{columnsJson}}\n\n" +
                "请返回一个 JSON 对象，包含 'tableDescription' (String) 和 'columnDescriptions' (Map<String, String>, key 为列名，value 为描述)。不要返回任何额外文字。")
        EnrichedDescriptions generateDescriptions(@V("tableName") String tableName, @V("columnsJson") String columnsJson);
    }
}
