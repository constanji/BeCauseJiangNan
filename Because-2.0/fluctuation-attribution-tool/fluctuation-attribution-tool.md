# 波动归因工具 (Fluctuation Attribution Tool)

## 概述

基于 Adtributor 算法的智能波动归因分析工具，当指标发生异常波动时，自动分析波动的根本原因。

**2.0 增强（已上线）**：
- **三类公式归因**（`structured_attribution`）：加法贡献度 / 乘法链式分解 / 除法差分+情景模拟
- **sql_hint 下钻闭环**：`next_steps[]` 携带可执行 SQL 提示
- **方法论警示**：掩盖效应、放大效应、稀释效应、伪加法陷阱

## 核心能力

### 1. 维度归因 (Dimension Attribution)
- **Adtributor 算法**：综合解释力（EP）、惊喜度（Surprise）、简洁性（Parsimony）
- **JS 散度**：衡量维度在基期和现期的分布差异
- **贡献度分解**：将整体变化分解到每个维度值

### 2. 公式归因 (Structured Attribution) ✅ 新增
| 类型 | metric_structure | 方法 |
|------|------------------|------|
| 加法型 | `additive` | 贡献度分解 ΔTotal = ΣΔXi |
| 乘法型 | `multiplicative` | 链式分解 (A₁-A₀)×B₀×C₀ … |
| 除法型 | `divisive` | 差分分解 + 情景模拟（控制分子/分母） |

### 3. 指标归因 (Metric Attribution)
- **ElasticNet 回归 / 特征重要性**：探索性子指标相关性（无明确公式时）
- **指标相关性**：Pearson 相关系数矩阵

### 4. 时间对比 (Time Comparison)
- 同比 / 环比 / 周比 / 日比 / 自定义时间区间

### 5. 维度下钻 + sql_hint
- 逐层下钻（最多 10 条路径）
- `next_steps[].sql_hint` / `filter` 引导 Agent 继续查数

## 输入参数（新增字段）

```json
{
  "analysis_type": "comprehensive",
  "base_data": [...],
  "current_data": [...],
  "metric_fields": ["gmv"],
  "target_metric": "gmv",
  "component_metrics": ["dau", "conversion_rate", "arpu"],
  "dimension_fields": ["region"],
  "metric_structure": "multiplicative",
  "factor_order": ["dau", "conversion_rate", "arpu"],
  "numerator_field": "paid_users",
  "denominator_field": "total_users"
}
```

- `metric_structure`: `auto` | `additive` | `multiplicative` | `divisive`
- `factor_order`: 乘法链式分解顺序（按业务漏斗）
- `numerator_field` / `denominator_field`: 除法型必填

## 输出结构（新增字段）

```json
{
  "structured_attribution": {
    "type": "multiplicative",
    "method": "chain_rule",
    "factors": [...],
    "topContributor": {...},
    "methodology_warnings": [...]
  },
  "dimension_attribution": { "dimensionRanking": [...], "drillPaths": [...] },
  "conclusion": "...",
  "next_steps": [
    {
      "action": "...",
      "sql_hint": "SELECT ...",
      "filter": "region = '华东'",
      "priority": "high"
    }
  ]
}
```

## 使用场景

1. **销售额波动**：Adtributor 维度归因 + 按 region 下钻
2. **GMV = DAU × 转化率 × 客单价**：`metric_structure=multiplicative` 链式分解
3. **转化率下降**：`metric_structure=divisive`，检测分母稀释效应
4. **分品类收入**：`metric_structure=additive`，贡献度 + 掩盖效应警示
