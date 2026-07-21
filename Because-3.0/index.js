/**
 * BeCauseSkills 3.0 - 智能问数工具集合（瘦身版）
 *
 * 相比 2.0：
 * - 移除 intent-classification / sql-validation / chart-generation / excel-lookup
 * - fluctuation-attribution 默认返回 LLM 消费版摘要（compact 模式）
 *
 * 子工具：
 * 1. knowledge-discovery-tool: 结构化知识行检索
 * 2. light-schema-tool: 预生成表结构缓存检索
 * 3. rag-retrieval-tool: RAG 知识检索（内置重排序）
 * 4. database-schema-tool: 数据库 Schema 实时获取
 * 5. sql-executor-tool: SQL 执行
 * 6. result-analysis-tool: 结果分析
 * 7. fluctuation-attribution-tool: 波动归因（默认瘦身输出）
 *
 * 核心算法模块：
 * - utils/statisticsEngine / timeComparison / dimensionDrillDown / metricAttribution
 * - utils/methodologyWarnings / metricStructureClassifier
 * - utils/additiveAttribution / multiplicativeAttribution / divisiveAttribution
 * - utils/drillDownHints
 */

const RAGRetrievalTool = require('./rag-retrieval-tool/scripts/RAGRetrievalTool');
const DatabaseSchemaTool = require('./database-schema-tool/scripts/DatabaseSchemaTool');
const ResultAnalysisTool = require('./result-analysis-tool/scripts/ResultAnalysisTool');
const SqlExecutorTool = require('./sql-executor-tool/scripts/SqlExecutorTool');
const FluctuationAttributionTool = require('./fluctuation-attribution-tool/scripts/FluctuationAttributionTool');
const KnowledgeDiscoveryTool = require('./knowledge-discovery-tool/scripts/KnowledgeDiscoveryTool');
const LightSchemaTool = require('./light-schema-tool/scripts/LightSchemaTool');

const StatisticsEngine = require('./utils/statisticsEngine');
const TimeComparison = require('./utils/timeComparison');
const DimensionDrillDown = require('./utils/dimensionDrillDown');
const MetricAttribution = require('./utils/metricAttribution');

const MethodologyWarnings = require('./utils/methodologyWarnings');
const MetricStructureClassifier = require('./utils/metricStructureClassifier');
const AdditiveAttribution = require('./utils/additiveAttribution');
const MultiplicativeAttribution = require('./utils/multiplicativeAttribution');
const DivisiveAttribution = require('./utils/divisiveAttribution');
const DrillDownHints = require('./utils/drillDownHints');

module.exports = {
  RAGRetrievalTool,
  DatabaseSchemaTool,
  ResultAnalysisTool,
  SqlExecutorTool,
  FluctuationAttributionTool,
  KnowledgeDiscoveryTool,
  LightSchemaTool,

  StatisticsEngine,
  TimeComparison,
  DimensionDrillDown,
  MetricAttribution,

  MethodologyWarnings,
  MetricStructureClassifier,
  AdditiveAttribution,
  MultiplicativeAttribution,
  DivisiveAttribution,
  DrillDownHints,
};
