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

- `compact: false` 或 `verbose: true`

## 默认输出结构（compact !== false）

公共 compact 外层：

```json
{
  "overview": {},
  "top_dimension": {},
  "top_contributors": [],
  "top_drill_path": null,
  "structured": {},
  "conclusion": "",
  "drill_query_hint": null
}
```

加法型 `structured`：

```json
{
  "type": "additive",
  "increase_total": 103000,
  "decrease_total": 3000,
  "top_increase": {},
  "top_decrease": {},
  "warnings": [{ "code": "", "title": "" }]
}
```

乘法型 `structured`：

```json
{
  "type": "multiplicative",
  "top_driver": {
    "drive_impact": 0
  },
  "warnings": [{ "code": "", "title": "" }]
}
```

除法型 `structured`：

```json
{
  "type": "divisive",
  "primary_driver": "denominator",
  "numerator_impact": 0,
  "denominator_impact": 0,
  "warnings": [{ "code": "", "title": "" }]
}
```

字段映射：
- `overview` ← `time_comparison.overview`（无则用 `dimension_attribution.overview`）
- `top_dimension` ← `dimensionRanking[0]` 的 dimension + Adtributor 分数 + 方向组汇总、各方向最大项及各方向 Top5（`top_increases/top_decreases`）
- `top_contributors` ← 该维按绝对变化混排的 Top3 变化项，含 `direction` 与非负 `direction_share`
- `top_drill_path` ← `drillPaths[0]`
- `structured` ← 精简 `structured_attribution`
- `conclusion` ← 短结论
- `drill_query_hint` ← 原 `next_steps[0]` 的 filter/sql_hint/action（**不返回完整 next_steps[]**）

变化归因不输出“贡献率/贡献度”或有符号占比：`changeRate` 表示项目自身变化率，`direction_share` 表示方向内影响占比。增加项和减少项分别以全量方向组合计为分母；应直接使用 `increase_total/decrease_total`，不得将截断后的 Top3 自行加总或重新归一化。维度归因在全量计算后返回 `top_increases` 与 `top_decreases`，分别按变化金额及绝对减少金额降序取最多 5 项；方向不足 5 项时返回实际数量，无该方向时返回空数组。原有 `top_contributors/top_increase/top_decrease` 保持兼容。加法型 `structured` 返回 `increase_total/decrease_total/top_increase/top_decrease`；乘法型返回 `top_driver.drive_impact`；除法型返回 `numerator_impact/denominator_impact`，后两者不使用方向内影响占比。

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
