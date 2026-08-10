import { AgentCapabilities, ArtifactModes } from '@because/data-provider';
import type {
  AgentModelParameters,
  SupportContact,
  AgentChartConfig,
  AgentProvider,
  GraphEdge,
  Agent,
} from '@because/data-provider';
import type { OptionWithIcon, ExtendedFile } from './types';

export type TAgentOption = OptionWithIcon &
  Agent & {
    knowledge_files?: Array<[string, ExtendedFile]>;
    context_files?: Array<[string, ExtendedFile]>;
    code_files?: Array<[string, ExtendedFile]>;
    _id?: string;
  };

export type TAgentCapabilities = {
  [AgentCapabilities.web_search]: boolean;
  [AgentCapabilities.file_search]: boolean;
  [AgentCapabilities.execute_code]: boolean;
  [AgentCapabilities.end_after_tools]?: boolean;
  [AgentCapabilities.hide_sequential_outputs]?: boolean;
  [AgentCapabilities.auto_chart]?: boolean;
};

export type AgentForm = {
  agent?: TAgentOption;
  id: string;
  name: string | null;
  description: string | null;
  instructions: string | null;
  model: string | null;
  model_parameters: AgentModelParameters;
  tools?: string[];
  provider?: AgentProvider | OptionWithIcon;
  /** @deprecated Use edges instead */
  agent_ids?: string[];
  edges?: GraphEdge[];
  [AgentCapabilities.artifacts]?: ArtifactModes | string;
  recursion_limit?: number;
  support_contact?: SupportContact;
  category: string;
  // Avatar management fields
  avatar_file?: File | null;
  avatar_preview?: string | null;
  avatar_action?: 'upload' | 'reset' | null;
  data_source_id?: string | null;
  /** 保存时写入本次 versions 快照的备注（不落 agent 顶层） */
  versionNote?: string | null;
  /** echarts_generator_app 行为配置；auto_chart（见 TAgentCapabilities）才是强制生图的唯一开关 */
  chart_config?: AgentChartConfig;
} & TAgentCapabilities;
