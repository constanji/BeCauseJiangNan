package ai.dat.core.contentstore;

import lombok.Getter;

/**
 * @Author JunjieM
 * @Date 2025/7/17
 */
@Getter
public enum ContentType {
    SQL("sql"), // 问题SQL对
    SYN("syn"), // 近义词对
    DOC("doc"), // 文档（业务知识）
    LIGHT_SCHEMA("light_schema"), // Light Schema（极简DDL）
    CELL("cell"), // 数据库单元格（用于字面量匹配）
    INDEX_ENTRY("index_entry"); // 指标库条目(指标问数候选召回)

    private final String value;

    ContentType(String value) {
        this.value = value;
    }

    @Override
    public String toString() {
        return value;
    }
}
