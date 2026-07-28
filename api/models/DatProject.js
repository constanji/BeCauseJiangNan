/**
 * DatProject Model
 * 
 * DAT 项目配置模型，基于 ProjectDocument.java 字段定义
 * 存储在独立的 DAT 数据库中
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { getDatConnection } = require('~/db/datConnect');

// 嵌套配置 Schema
const ProviderConfigSchema = new Schema({
    provider: { type: String, required: true },
    configuration: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const LlmConfigSchema = new Schema({
    name: { type: String, required: true },
    provider: { type: String, required: true },
    configuration: { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const AgentConfigSchema = new Schema({
    name: { type: String, required: true },
    description: { type: String },
    provider: { type: String, required: true },
    configuration: { type: Schema.Types.Mixed, default: {} },
    semantic_models: { type: [String], default: [] },
    semantic_model_tags: { type: [String], default: [] },
}, { _id: false });

// 主 DatProject Schema
const DatProjectSchema = new Schema({
    version: { type: Number, default: 1 },
    name: { type: String, required: true, unique: true, index: true },
    description: { type: String },
    configuration: { type: Schema.Types.Mixed, default: {} },
    db: { type: ProviderConfigSchema },
    embedding: { type: ProviderConfigSchema },
    embedding_store: { type: ProviderConfigSchema },
    llms: { type: [LlmConfigSchema], default: [] },
    reranking: { type: ProviderConfigSchema },
    content_store: { type: ProviderConfigSchema },
    agents: { type: [AgentConfigSchema], default: [] },
}, {
    timestamps: true,
    collection: 'projects',
});

let DatProjectModel = null;

/**
 * 获取 DatProject 模型
 * @returns {Promise<mongoose.Model>}
 */
async function getDatProjectModel() {
    if (DatProjectModel) {
        return DatProjectModel;
    }

    const connection = await getDatConnection();
    if (!connection) {
        throw new Error('DAT database connection not available');
    }

    DatProjectModel = connection.model('DatProject', DatProjectSchema);
    return DatProjectModel;
}

module.exports = {
    getDatProjectModel,
    DatProjectSchema,
};
