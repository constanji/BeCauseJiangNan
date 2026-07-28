const { getDatasourcePromptModel } = require("../../models/DatasourcePrompt");

const MAX_PROMPTS_PER_DATASOURCE = 8;

// Get all prompts for a datasource
exports.list = async (req, res) => {
  try {
    const DatasourcePrompt = await getDatasourcePromptModel();
    const { datasourceId, includeDisabled } = req.query;

    if (!datasourceId) {
      return res.status(400).json({ error: "datasourceId is required" });
    }

    const filter = { datasourceId };
    if (!includeDisabled) {
      filter.enabled = true;
    }

    const prompts = await DatasourcePrompt.find(filter).sort({
      sortOrder: 1,
      createdAt: 1,
    });
    res.json({ prompts });
  } catch (error) {
    console.error("Error listing datasource prompts:", error);
    res.status(500).json({ error: "Failed to list prompts" });
  }
};

// Get single prompt
exports.get = async (req, res) => {
  try {
    const DatasourcePrompt = await getDatasourcePromptModel();
    const prompt = await DatasourcePrompt.findById(req.params.id);
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }
    res.json({ prompt });
  } catch (error) {
    console.error("Error getting prompt:", error);
    res.status(500).json({ error: "Failed to get prompt" });
  }
};

// Create prompt
exports.create = async (req, res) => {
  try {
    const DatasourcePrompt = await getDatasourcePromptModel();
    const { datasourceId, projectId, label, content } = req.body;

    if (!datasourceId || !projectId || !label || !content) {
      return res.status(400).json({
        error: "datasourceId, projectId, label, and content are required",
      });
    }

    // Check count limit
    const existingCount = await DatasourcePrompt.countDocuments({
      datasourceId,
    });
    if (existingCount >= MAX_PROMPTS_PER_DATASOURCE) {
      return res.status(400).json({
        error: `每个数据源最多只能添加 ${MAX_PROMPTS_PER_DATASOURCE} 个提示词`,
      });
    }

    // Auto-assign sortOrder if not provided
    if (req.body.sortOrder === undefined) {
      const maxSortOrder = await DatasourcePrompt.findOne({ datasourceId })
        .sort({ sortOrder: -1 })
        .select("sortOrder");
      req.body.sortOrder = maxSortOrder ? maxSortOrder.sortOrder + 1 : 0;
    }

    const prompt = new DatasourcePrompt(req.body);
    await prompt.save();
    res.status(201).json(prompt);
  } catch (error) {
    console.error("Error creating prompt:", error);
    res.status(500).json({ error: "Failed to create prompt" });
  }
};

// Update prompt
exports.update = async (req, res) => {
  try {
    const DatasourcePrompt = await getDatasourcePromptModel();
    const { id } = req.params;

    const prompt = await DatasourcePrompt.findByIdAndUpdate(
      id,
      { $set: req.body },
      { new: true, runValidators: true },
    );

    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }
    res.json(prompt);
  } catch (error) {
    console.error("Error updating prompt:", error);
    res.status(500).json({ error: "Failed to update prompt" });
  }
};

// Delete prompt
exports.delete = async (req, res) => {
  try {
    const DatasourcePrompt = await getDatasourcePromptModel();
    const { id } = req.params;
    const prompt = await DatasourcePrompt.findByIdAndDelete(id);

    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }
    res.json({ message: "Prompt deleted successfully" });
  } catch (error) {
    console.error("Error deleting prompt:", error);
    res.status(500).json({ error: "Failed to delete prompt" });
  }
};

// Batch update (for reordering)
exports.batchUpdate = async (req, res) => {
  try {
    const DatasourcePrompt = await getDatasourcePromptModel();
    const { prompts } = req.body;

    if (!Array.isArray(prompts)) {
      return res.status(400).json({ error: "prompts array is required" });
    }

    const bulkOps = prompts.map((item, index) => ({
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            sortOrder: item.sortOrder !== undefined ? item.sortOrder : index,
          },
        },
      },
    }));

    await DatasourcePrompt.bulkWrite(bulkOps);
    res.json({ message: "Batch update successful" });
  } catch (error) {
    console.error("Error batch updating prompts:", error);
    res.status(500).json({ error: "Failed to batch update prompts" });
  }
};
