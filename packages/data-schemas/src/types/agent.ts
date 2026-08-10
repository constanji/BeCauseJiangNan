import { Document, Types } from 'mongoose';
import type { GraphEdge } from '@because/data-provider';

export interface ISupportContact {
  name?: string;
  email?: string;
}

export interface IAgentChartConfig {
  /** 'custom' 复用通用行数据判定（role 固定 general）；indicator/attribution 各自套用专属规则 */
  preset?: 'indicator' | 'attribution' | 'custom';
  /** echarts_generator_app 暴露给模型的入参 schema：simple=简版协议，legacy=完整 echartsOption */
  input_mode?: 'simple' | 'legacy';
  /** 占位符 @ec@<marker>:<id>@ec@ 里的 marker，最长 32 位字母数字下划线 */
  marker?: string;
  /** prepend=插入正文最前；semantic=按角色语义落位到对应章节 */
  placement?: 'prepend' | 'semantic';
  /** 单轮（单条 AI 消息）最多生成的图表张数，1-5 */
  max_charts?: number;
  /** 是否对 indicator/contribution/drag 做单轮同角色去重；未配置时默认开启 */
  dedupe_roles?: boolean;
  /**
   * 开启后工具输出的 echartsOption 不包含 legend（即便入参/默认样式已带 legend 也会剥离）。
   * 用于对接方前端 title 与 legend 定位重叠等场景。
   */
  hide_legend?: boolean;
  /** 模型不可见图表工具；不影响服务端自动生图调用 */
  hide_from_model?: boolean;
  match_rules?: IAgentChartMatchRules;
}

export interface IAgentChartMatchRules {
  time_series?: {
    enabled?: boolean;
    chart_type?: 'line' | 'bar';
    min_periods?: number;
    max_points?: number;
    sort?: 'time_asc' | 'time_desc';
  };
  dimension_compare?: {
    enabled?: boolean;
    chart_type?: 'pie' | 'bar';
    min_categories?: number;
    sort?: 'value_desc' | 'value_asc' | 'dimension_asc' | 'source';
    pie_top_n?: number;
    bar_max_items?: number;
  };
  baseline_compare?: {
    enabled?: boolean;
    chart_type?: 'line' | 'bar';
    min_points?: number;
    order?: 'history_to_current' | 'current_to_history';
  };
}

export interface IAgent extends Omit<Document, 'model'> {
  id: string;
  name?: string;
  description?: string;
  instructions?: string;
  avatar?: {
    filepath: string;
    source: string;
  };
  provider: string;
  model: string;
  model_parameters?: Record<string, unknown>;
  artifacts?: string;
  access_level?: number;
  recursion_limit?: number;
  tools?: string[];
  tool_kwargs?: Array<unknown>;
  actions?: string[];
  author: Types.ObjectId;
  authorName?: string;
  hide_sequential_outputs?: boolean;
  end_after_tools?: boolean;
  /** Server-side auto chart after data-query tools succeed */
  auto_chart?: boolean;
  /** echarts_generator_app behavior config; undefined means legacy protocol, no enabled flag here (see auto_chart) */
  chart_config?: IAgentChartConfig;
  /** @deprecated Use edges instead */
  agent_ids?: string[];
  edges?: GraphEdge[];
  /** @deprecated Use ACL permissions instead */
  isCollaborative?: boolean;
  conversation_starters?: string[];
  tool_resources?: unknown;
  projectIds?: Types.ObjectId[];
  versions?: Omit<IAgent, 'versions'>[];
  category: string;
  support_contact?: ISupportContact;
  is_promoted?: boolean;
  data_source_id?: string;
}
