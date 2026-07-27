/**
 * BeCauseSkills 江南（Because-jn）— 以 Because-3.0 为蓝本的专用 fork
 *
 * 相对 3.0 的特有能力：
 * - indicator-understanding：固定检索「指标定义信息」
 * - org-context：固定检索「机构信息」
 * - 不导出 / 不挂载 knowledge-discovery（查指标/机构请用上述专用工具）
 *
 * 子工具：
 * 1. indicator-understanding-tool: 指标理解
 * 2. org-context-tool: 机构背景
 * 3. light-schema-tool: 预生成表结构缓存检索
 * 4. rag-retrieval-tool: RAG 知识检索（内置重排序）
 * 5. database-schema-tool: 数据库 Schema 实时获取
 * 6. sql-executor-tool: SQL 执行
 * 7. fluctuation-attribution-tool: 波动归因（默认瘦身输出）
 * （不挂 result-analysis：KPI 下钻由归因路径甲/乙约束，解读由模型直接基于 rows）
 *
 * 核心算法模块：与 Because-3.0 对齐
 * - utils/statisticsEngine / timeComparison / dimensionDrillDown / metricAttribution
 * - utils/methodologyWarnings / metricStructureClassifier
 * - utils/additiveAttribution / multiplicativeAttribution / divisiveAttribution
 * - utils/drillDownHints
 * - utils/excelCellDiscovery
 */

const RAGRetrievalTool = require('./rag-retrieval-tool/scripts/RAGRetrievalTool');
const DatabaseSchemaTool = require('./database-schema-tool/scripts/DatabaseSchemaTool');
const SqlExecutorTool = require('./sql-executor-tool/scripts/SqlExecutorTool');
const FluctuationAttributionTool = require('./fluctuation-attribution-tool/scripts/FluctuationAttributionTool');
const IndicatorUnderstandingTool = require('./indicator-understanding-tool/scripts/IndicatorUnderstandingTool');
const OrgContextTool = require('./org-context-tool/scripts/OrgContextTool');
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
  SqlExecutorTool,
  FluctuationAttributionTool,
  IndicatorUnderstandingTool,
  OrgContextTool,
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
