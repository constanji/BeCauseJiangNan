package ai.dat.core.contentstore.data;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 单元格匹配结果数据模型
 * 用于字面量模糊匹配
 * 
 * @Author DAT Team
 * @Date 2026/1/5
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CellMatch {
    
    /**
     * 表名
     */
    private String tableName;
    
    /**
     * 列名
     */
    private String columnName;
    
    /**
     * 单元格值
     */
    private String cellValue;
    
    /**
     * 匹配分数
     */
    private double score;
    
    /**
     * 格式化输出
     * 例如: country.name = "日本"
     */
    public String toMatchString() {
        return tableName + "." + columnName + " = \"" + cellValue + "\"";
    }
}
