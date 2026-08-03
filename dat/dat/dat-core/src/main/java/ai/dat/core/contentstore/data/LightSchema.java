package ai.dat.core.contentstore.data;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Light Schema 数据模型
 * 极简版描述，用于替代完整的语义模型
 * 支持 DDL 和 Markdown 两种格式
 * 
 * @Author DAT Team
 * @Date 2026/1/5
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LightSchema {
    
    /**
     * 表名
     */
    private String tableName;

    /**
     * 表描述
     */
    private String tableDescription;
    
    /**
     * 列信息列表
     */
    @Builder.Default
    private List<ColumnInfo> columns = new ArrayList<>();
    
    /**
     * 主键列名列表
     */
    @Builder.Default
    private List<String> primaryKeys = new ArrayList<>();
    
    /**
     * 外键关系列表
     */
    @Builder.Default
    private List<ForeignKey> foreignKeys = new ArrayList<>();

    /**
     * 索引列表
     */
    @Builder.Default
    private List<String> indices = new ArrayList<>();
    
    /**
     * 将 Light Schema 转换为极简 DDL 字符串
     */
    public String toDDL() {
        StringBuilder ddl = new StringBuilder();
        if (tableDescription != null && !tableDescription.isEmpty()) {
            ddl.append("-- ").append(tableDescription).append("\n");
        }
        ddl.append("CREATE TABLE ").append(tableName).append(" (\n");
        
        // 列定义
        List<String> columnDefs = new ArrayList<>();
        for (ColumnInfo col : columns) {
            StringBuilder colDef = new StringBuilder();
            colDef.append("  ").append(col.getName()).append(" ").append(col.getType());
            
            // 标记主键
            if (primaryKeys.contains(col.getName())) {
                colDef.append(" PRIMARY KEY");
            }
            
            // 添加注释
            StringBuilder comment = new StringBuilder();
            if (col.getDescription() != null && !col.getDescription().isEmpty()) {
                comment.append(col.getDescription());
            }
            
            // 添加采样值注释
            if (col.getSampleValues() != null && !col.getSampleValues().isEmpty()) {
                if (comment.length() > 0) comment.append(", ");
                String samples = col.getSampleValues().stream()
                        .map(v -> v == null ? "NULL" : "\"" + v + "\"")
                        .collect(Collectors.joining(", "));
                comment.append("samples: [").append(samples).append("]");
            }

            if (comment.length() > 0) {
                colDef.append("  -- ").append(comment);
            }
            
            columnDefs.add(colDef.toString());
        }
        
        // 外键约束
        for (ForeignKey fk : foreignKeys) {
            columnDefs.add("  FOREIGN KEY (" + fk.getColumnName() + ") REFERENCES " 
                    + fk.getReferencedTable() + "(" + fk.getReferencedColumn() + ")");
        }
        
        ddl.append(String.join(",\n", columnDefs));
        ddl.append("\n);");
        
        return ddl.toString();
    }

    /**
     * 将 Light Schema 转换为 Markdown 字符串 (参考 Python logic)
     */
    public String toMarkdown() {
        StringBuilder md = new StringBuilder();
        md.append("## Table: ").append(tableName).append("\n");
        md.append("### Table description\n").append(tableDescription != null ? tableDescription : "").append("\n");
        
        md.append("### Column information\n");
        md.append("| column_name | column_type | column_description | value_examples |\n");
        md.append("| --- | --- | --- | --- |\n");
        
        for (ColumnInfo col : columns) {
            String samples = col.getSampleValues() != null ? col.getSampleValues().toString() : "[]";
            md.append("| ").append(col.getName()).append(" | ")
              .append(col.getType()).append(" | ")
              .append(col.getDescription() != null ? col.getDescription() : "").append(" | ")
              .append(samples).append(" |\n");
        }
        
        if (primaryKeys != null && !primaryKeys.isEmpty()) {
            md.append("### Primary keys\n").append(primaryKeys).append("\n");
        }
        
        if (foreignKeys != null && !foreignKeys.isEmpty()) {
            md.append("### Foreign keys\n");
            for (ForeignKey fk : foreignKeys) {
                md.append("- ").append(fk.getColumnName()).append(" -> ")
                  .append(fk.getReferencedTable()).append("(").append(fk.getReferencedColumn()).append(")\n");
            }
        }
        
        if (indices != null && !indices.isEmpty()) {
            md.append("### Index\n").append(indices).append("\n");
        }
        
        return md.toString();
    }
    
    /**
     * 列信息
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ColumnInfo {
        private String name;
        private String type;
        private boolean nullable;
        private String description;
        @Builder.Default
        private List<String> sampleValues = new ArrayList<>();
    }
    
    /**
     * 外键关系
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ForeignKey {
        private String columnName;
        private String referencedTable;
        private String referencedColumn;
    }
}
