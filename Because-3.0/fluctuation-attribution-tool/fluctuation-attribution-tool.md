# 波动归因工具 (Fluctuation Attribution Tool) — 3.0

## 概述

基于 Adtributor 算法的智能波动归因分析工具。**3.0 默认返回 LLM 消费版摘要**，显著降低 token 占用。

## 3.0 行为变更（相对 2.0）

| 项 | 2.0 默认 | 3.0 默认 |
|----|---------|---------|
| `comprehensive` 是否算 `metric_attribution` | 是 | **否**（仅 `analysis_type: metric` 或 `include_metric_attribution: true`） |
| JSON 序列化 | `JSON.stringify(_, null, 2)` | **`JSON.stringify(_)` 无缩进** |
| 默认输出结构 | 全量 `dimension_attribution` / `next_steps[]` 等 | **瘦身摘要**（见下） |
| `drillPaths` | Top 3 | **Top 1** |
| `topContributors` | Top 5 | **Top 3** |

### 调试开关

- `compact: false` 或 `verbose: true` → 返回接近 2.0 的完整报告（仍无 pretty JSON）

## 默认输出结构（compact !== false）

```json
{
  "overview": {},
  "top_dimension": {},
  "top_contributors": [],
  "top_drill_path": null,
  "structured": {
    "type": "multiplicative",
    "topContributor": {},
    "warnings": [{ "code": "", "title": "" }]
  },
  "conclusion": "",
  "drill_query_hint": null
}
```

字段映射：
- `overview` ← `time_comparison.overview`（无则用 `dimension_attribution.overview`）
- `top_dimension` ← `dimensionRanking[0]` 的 dimension + Adtributor 分数（不含完整贡献列表）
- `top_contributors` ← 该维 Top3 贡献项
- `top_drill_path` ← `drillPaths[0]`
- `structured` ← 精简 `structured_attribution`
- `conclusion` ← 短结论
- `drill_query_hint` ← 原 `next_steps[0]` 的 filter/sql_hint/action（**不返回完整 next_steps[]**）

## 输入参数（关键）

```json
{
  "analysis_type": "comprehensive",
  "base_data": [...],
  "current_data": [...],
  "metric_fields": ["index_value"],
  "dimension_fields": ["org_name"],
  "compact": true,
  "include_metric_attribution": false,
  "metric_structure": "auto"
}
```

- `compact`：默认 `true`（LLM 摘要）
- `verbose`：默认 `false`；`true` 等同 `compact: false`
- `include_metric_attribution`：默认 `false`；comprehensive 下是否额外算回归类指标归因

## 核心能力（内部仍计算，compact 模式下投影输出）

- 维度归因（Adtributor）
- 公式归因（加法 / 乘法 / 除法）
- 时间对比（同比/环比/自定义）
- 维度下钻（默认 Top1 路径）
