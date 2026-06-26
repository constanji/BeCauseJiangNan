# Agent 工具参考手册（人类 / 开发用，非系统提示词）

> Agent 系统提示词见 `instructions.md`。本文档存放详细参数、公式、示例与输出模板。

---

## 检索能力

详见 [`检索能力说明.md`](./检索能力说明.md)、[`检索触发条件与流程说明.md`](./检索触发条件与流程说明.md)。

---

## light_schema 参数

| 场景 | arguments 示例 |
|------|----------------|
| 常规问数 | `{"query": "用户问题", "top_k": 8}` |
| 已知表名 | `{"query": "", "tables": ["card", "loan"]}` |
| 单表试探 | `{"query": "...", "top_k": 1}` |
| 全量表结构 | 改用 `database-schema`，不用 light_schema |

返回：`semantic_models`、`value_hints`（Cell 值对齐，可能为空）、`retrieval_info`。

---

## rag_retrieval / knowledge_discovery

- **rag_retrieval**：`top_k` 默认 10，max 50；`use_reranking` 默认 true
- **knowledge_discovery**：`top_k` 默认 5；指标编码 BMxxx 一次查一个

---

## fluctuation_attribution

### metric_structure

| 类型 | 场景 | 参数 |
|------|------|------|
| additive | Y=A+B+… | target_metric + component_metrics |
| multiplicative | GMV=DAU×转化×客单价 | component_metrics + factor_order |
| divisive | 转化率=分子/分母 | numerator_field + denominator_field |
| auto | 不确定 | 尽量提供 component 或分子分母 |

有明确公式时**禁止**仅用 ElasticNet 回归代替 structured_attribution。

### 乘法链式分解（factor_order 顺序）

- A: `(A₁-A₀)×B₀×C₀`
- B: `A₁×(B₁-B₀)×C₀`
- C: `A₁×B₁×(C₁-C₀)`

### Adtributor 指标

EP（解释力）、Surprise（惊喜度）、Parsimony（简洁性）；评分 = 0.5×EP + 0.3×Surprise + 0.2×Parsimony

### 下钻

优先使用 `next_steps[].sql_hint` / `filter`，勿凭空编 SQL。

---

## SQL 铁律（详版）

### 语义

- 明确统计粒度；占比需分子分母明确
- 性别：F/M；贷款资格：`disp.type = 'OWNER'`
- 地区名优先 `district.A2`；平均薪资 `district.A11`

### JOIN

- **单事实表聚合** → 简单 SQL，禁止无意义 CTE
- **多事实表同时聚合** → 先分别聚合再 JOIN，防行膨胀
- LEFT JOIN 聚合字段用 COALESCE

### 性能

- 简洁优先；避免方言；ORDER BY 字段须已在本层计算

---

## 输出模板

### 标准查询

```
## 查询结果
### 执行的SQL
### 查询结果（>3 行用表格，列名中文）
### 分析（如有）
```

### 波动归因

```
## 波动归因分析
### 总体变化
### 执行的SQL（基期+现期）
### 公式归因 / 维度归因 / 下钻路径 / next_steps
### 结论与建议
```

---

## result-analysis vs fluctuation-attribution

| 场景 | 工具 |
|------|------|
| 单次结果解释 | result-analysis (standard) |
| 异常值 / 趋势 | result-analysis (deep) |
| 为什么涨跌 / 同比环比 | fluctuation-attribution |
| 有明确公式 | fluctuation-attribution + metric_structure |
