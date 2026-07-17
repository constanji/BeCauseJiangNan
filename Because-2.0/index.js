/**
 * BeCauseSkills 2.0 - 智能问数工具集合（重构版）
 *
 * 重构后的智能问数工具系统，新增波动归因能力：
 * 1. intent-classification-tool: 意图分类
 * 2. rag-retrieval-tool: RAG知识检索（内置重排序）
 * 3. database-schema-tool: 数据库Schema获取
 * 4. sql-validation-tool: SQL校验（增强：7类关键字分类 + 双盲对比 + 对齐检查）
 * 5. result-analysis-tool: 结果分析（增强：Adtributor归因 + 异常检测 + 趋势分析 + sql_hint下钻）
 * 6. sql-executor-tool: SQL执行
 * 7. chart-generation-tool: 图表生成
 * 8. fluctuation-attribution-tool: 波动归因（三类公式引擎 + sql_hint下钻闭环）
 * 9. knowledge-discovery-tool / light-schema-tool
 *
 * 核心算法模块：
 * - utils/statisticsEngine: 统计算法引擎（KL/JS散度、解释力、简洁性、惊喜度）
 * - utils/timeComparison: 时间对比模块（同比/环比/自定义）
 * - utils/dimensionDrillDown: 维度下钻模块（Adtributor算法）
 * - utils/metricAttribution: 指标归因模块（线性回归/ElasticNet/特征重要性）
 *
 * 新增归因方法论模块（迁移自 resultMCP）：
 * - utils/methodologyWarnings: 方法论警示（掩盖/放大/稀释效应、伪加法陷阱）
 * - utils/metricStructureClassifier: 指标结构自动识别（加法/乘法/除法）
 * - utils/additiveAttribution: 加法型贡献度分解
 * - utils/multiplicativeAttribution: 乘法型链式分解（公式驱动）
 * - utils/divisiveAttribution: 除法型差分分解 + 情景模拟
 * - utils/drillDownHints: sql_hint 下钻闭环引导
 */

const IntentClassificationTool = require('./intent-classification-tool/scripts/IntentClassificationTool');
const RAGRetrievalTool = require('./rag-retrieval-tool/scripts/RAGRetrievalTool');
const DatabaseSchemaTool = require('./database-schema-tool/scripts/DatabaseSchemaTool');
const SQLValidationTool = require('./sql-validation-tool/scripts/SQLValidationTool');
const ResultAnalysisTool = require('./result-analysis-tool/scripts/ResultAnalysisTool');
const SqlExecutorTool = require('./sql-executor-tool/scripts/SqlExecutorTool');
const ChartGenerationTool = require('./chart-generation-tool/scripts/ChartGenerationTool');
const FluctuationAttributionTool = require('./fluctuation-attribution-tool/scripts/FluctuationAttributionTool');
const KnowledgeDiscoveryTool = require('./knowledge-discovery-tool/scripts/KnowledgeDiscoveryTool');
const LightSchemaTool = require('./light-schema-tool/scripts/LightSchemaTool');

const StatisticsEngine = require('./utils/statisticsEngine');
const TimeComparison = require('./utils/timeComparison');
const DimensionDrillDown = require('./utils/dimensionDrillDown');
const MetricAttribution = require('./utils/metricAttribution');

// ---- 新增归因方法论模块 ----
const MethodologyWarnings = require('./utils/methodologyWarnings');
const MetricStructureClassifier = require('./utils/metricStructureClassifier');
const AdditiveAttribution = require('./utils/additiveAttribution');
const MultiplicativeAttribution = require('./utils/multiplicativeAttribution');
const DivisiveAttribution = require('./utils/divisiveAttribution');
const DrillDownHints = require('./utils/drillDownHints');

module.exports = {
  // 工具类
  IntentClassificationTool,
  RAGRetrievalTool,
  DatabaseSchemaTool,
  SQLValidationTool,
  ResultAnalysisTool,
  SqlExecutorTool,
  ChartGenerationTool,
  FluctuationAttributionTool,
  KnowledgeDiscoveryTool,
  LightSchemaTool,

  // 原有算法模块
  StatisticsEngine,
  TimeComparison,
  DimensionDrillDown,
  MetricAttribution,

  // 新增归因方法论模块
  MethodologyWarnings,
  MetricStructureClassifier,
  AdditiveAttribution,
  MultiplicativeAttribution,
  DivisiveAttribution,
  DrillDownHints,
};
