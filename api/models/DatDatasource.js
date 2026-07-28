const mongoose = require("mongoose");
const { getDatConnection } = require("../db/datConnect");

const datDatasourceSchema = new mongoose.Schema(
  {
    projectId: {
      type: String,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: String,
    provider: {
      type: String, // e.g., 'mysql', 'postgresql', 'duckdb'
      required: true,
    },
    configuration: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    agentNames: {
      type: [String],
      default: [],
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "datasources",
  },
);

// Compound index for unique name per project (mirrors Java: @CompoundIndex)
datDatasourceSchema.index({ projectId: 1, name: 1 }, { unique: true });

module.exports = {
  /**
   * Get the DatDatasource model (async - connection must be awaited)
   * @returns {Promise<mongoose.Model>}
   */
  getDatDatasourceModel: async () => {
    const conn = await getDatConnection();
    if (!conn) {
      throw new Error("DAT MongoDB connection not available");
    }
    // Check if model already exists on connection to avoid OverwriteModelError
    if (conn.models.DatDatasource) {
      return conn.models.DatDatasource;
    }
    return conn.model("DatDatasource", datDatasourceSchema);
  },
};
