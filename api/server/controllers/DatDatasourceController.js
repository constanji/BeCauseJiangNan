const { getDatDatasourceModel } = require('../../models/DatDatasource');

// Get all datasources (optionally filter by projectId)
exports.list = async (req, res) => {
    try {
        const DatDatasource = await getDatDatasourceModel();
        const filter = {};
        if (req.query.projectId) {
            filter.projectId = req.query.projectId;
        }

        const datasources = await DatDatasource.find(filter).sort({ createdAt: -1 });
        res.json({ datasources });
    } catch (error) {
        console.error('Error listing datasources:', error);
        res.status(500).json({ error: 'Failed to list datasources' });
    }
};

// Get single datasource
exports.get = async (req, res) => {
    try {
        const DatDatasource = await getDatDatasourceModel();
        const datasource = await DatDatasource.findById(req.params.id);
        if (!datasource) {
            return res.status(404).json({ error: 'Datasource not found' });
        }
        res.json({ datasource });
    } catch (error) {
        console.error('Error getting datasource:', error);
        res.status(500).json({ error: 'Failed to get datasource' });
    }
};

// Helper to remove agent bindings from other datasources in the same project
const ensureUniqueAgentBinding = async (model, projectId, currentDatasourceId, agentNames) => {
    if (!agentNames || agentNames.length === 0) return;

    const filter = {
        projectId: projectId,
        agentNames: { $in: agentNames }
    };

    if (currentDatasourceId) {
        filter._id = { $ne: currentDatasourceId };
    }

    await model.updateMany(filter, {
        $pullAll: { agentNames: agentNames }
    });
};

// Create datasource
exports.create = async (req, res) => {
    try {
        const DatDatasource = await getDatDatasourceModel();

        // Handle Agent Binding Uniqueness
        if (req.body.agentNames && req.body.agentNames.length > 0 && req.body.projectId) {
            await ensureUniqueAgentBinding(DatDatasource, req.body.projectId, null, req.body.agentNames);
        }

        const datasource = new DatDatasource(req.body);
        await datasource.save();
        res.status(201).json(datasource);
    } catch (error) {
        console.error('Error creating datasource:', error);
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Datasource name already exists in this project' });
        }
        res.status(500).json({ error: 'Failed to create datasource' });
    }
};

// Update datasource
exports.update = async (req, res) => {
    try {
        const DatDatasource = await getDatDatasourceModel();
        const { id } = req.params;
        const updates = req.body;

        // Handle Agent Binding Uniqueness
        // Note: We need projectId. If not in updates (partial update), fetch original. 
        // But usually frontend sends full object. If strict partial update, might need lookup.
        // Assuming updates contains projectId or we fetch it.
        let projectId = updates.projectId;
        if (!projectId) {
            const existing = await DatDatasource.findById(id);
            if (existing) projectId = existing.projectId;
        }

        if (updates.agentNames && updates.agentNames.length > 0 && projectId) {
            await ensureUniqueAgentBinding(DatDatasource, projectId, id, updates.agentNames);
        }

        const datasource = await DatDatasource.findByIdAndUpdate(
            id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!datasource) {
            return res.status(404).json({ error: 'Datasource not found' });
        }
        res.json(datasource);
    } catch (error) {
        console.error('Error updating datasource:', error);
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Datasource name already exists in this project' });
        }
        res.status(500).json({ error: 'Failed to update datasource' });
    }
};

// Delete datasource
exports.delete = async (req, res) => {
    try {
        const DatDatasource = await getDatDatasourceModel();
        const { id } = req.params;
        const datasource = await DatDatasource.findByIdAndDelete(id);

        if (!datasource) {
            return res.status(404).json({ error: 'Datasource not found' });
        }
        res.json({ message: 'Datasource deleted successfully' });
    } catch (error) {
        console.error('Error deleting datasource:', error);
        res.status(500).json({ error: 'Failed to delete datasource' });
    }
};
