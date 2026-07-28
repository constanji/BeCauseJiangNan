const mongoose = require("mongoose");
const { getDatConnection } = require("../db/datConnect");

const datasourcePromptSchema = new mongoose.Schema(
  {
    datasourceId: {
      type: String,
      required: true,
      index: true,
    },
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      maxlength: 50,
    },
    description: {
      type: String,
      maxlength: 200,
    },
    content: {
      type: String,
      required: true,
      maxlength: 500,
    },
    icon: {
      type: String,
      default: "BulbOutlined",
    },
    iconColor: {
      type: String,
      default: "#FFD700",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "datasource_prompts",
  },
);

// Compound index for efficient queries
datasourcePromptSchema.index({ datasourceId: 1, sortOrder: 1 });

module.exports = {
  /**
   * Get the DatasourcePrompt model (async - connection must be awaited)
   * @returns {Promise<mongoose.Model>}
   */
  getDatasourcePromptModel: async () => {
    const conn = await getDatConnection();
    if (!conn) {
      throw new Error("DAT MongoDB connection not available");
    }
    // Check if model already exists on connection to avoid OverwriteModelError
    if (conn.models.DatasourcePrompt) {
      return conn.models.DatasourcePrompt;
    }
    return conn.model("DatasourcePrompt", datasourcePromptSchema);
  },
};
