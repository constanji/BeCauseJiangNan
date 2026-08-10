import { Schema } from 'mongoose';
import type { IAgent } from '~/types';

const agentSchema = new Schema<IAgent>(
  {
    id: {
      type: String,
      index: true,
      unique: true,
      required: true,
    },
    name: {
      type: String,
    },
    description: {
      type: String,
    },
    instructions: {
      type: String,
    },
    avatar: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    provider: {
      type: String,
      required: true,
    },
    model: {
      type: String,
      required: true,
    },
    model_parameters: {
      type: Object,
    },
    artifacts: {
      type: String,
    },
    access_level: {
      type: Number,
    },
    recursion_limit: {
      type: Number,
    },
    tools: {
      type: [String],
      default: undefined,
    },
    tool_kwargs: {
      type: [{ type: Schema.Types.Mixed }],
    },
    actions: {
      type: [String],
      default: undefined,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorName: {
      type: String,
      default: undefined,
    },
    hide_sequential_outputs: {
      type: Boolean,
    },
    end_after_tools: {
      type: Boolean,
    },
    /** 查数工具返回后由服务端自动出图（治本管道）的唯一开关，默认关闭；chart_config 只决定触发后如何出图 */
    auto_chart: {
      type: Boolean,
    },
    /**
     * echarts_generator_app 的行为配置：入参协议、marker、位置策略、单轮上限。
     * 没有该字段的历史 Agent 一律按 legacy 协议处理，不做数据迁移。
     */
    chart_config: {
      type: {
        preset: {
          type: String,
          enum: ['indicator', 'attribution', 'custom'],
        },
        input_mode: {
          type: String,
          enum: ['simple', 'legacy'],
        },
        marker: {
          type: String,
          maxlength: 32,
          match: /^[A-Za-z0-9_]*$/,
        },
        placement: {
          type: String,
          enum: ['prepend', 'semantic'],
        },
        max_charts: {
          type: Number,
          min: 1,
          max: 5,
        },
        /** 默认开启；关闭后允许同一轮出现多个相同业务角色图表 */
        dedupe_roles: {
          type: Boolean,
        },
        /** 开启后工具输出剥离 legend，避免对接方前端 title/legend 重叠 */
        hide_legend: {
          type: Boolean,
        },
        /** 模型不可见图表工具；ToolNode 仍保留服务端执行权限 */
        hide_from_model: {
          type: Boolean,
        },
        match_rules: {
          type: Schema.Types.Mixed,
        },
      },
      default: undefined,
    },
    /** @deprecated Use edges instead */
    agent_ids: {
      type: [String],
    },
    edges: {
      type: [{ type: Schema.Types.Mixed }],
      default: [],
    },
    isCollaborative: {
      type: Boolean,
      default: undefined,
    },
    conversation_starters: {
      type: [String],
      default: [],
    },
    tool_resources: {
      type: Schema.Types.Mixed,
      default: {},
    },
    projectIds: {
      type: [Schema.Types.ObjectId],
      ref: 'Project',
      index: true,
    },
    versions: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    category: {
      type: String,
      trim: true,
      index: true,
      default: 'general',
    },
    support_contact: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    is_promoted: {
      type: Boolean,
      default: false,
      index: true,
    },
    data_source_id: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

agentSchema.index({ updatedAt: -1, _id: 1 });

export default agentSchema;
