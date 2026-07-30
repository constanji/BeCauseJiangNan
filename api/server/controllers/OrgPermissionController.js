const { logger } = require('@because/data-schemas');
const { OrgPermissionUnit, OrgPermissionSettings } = require('~/db/models');
const { invalidateOrgPermissionCache } = require('~/server/services/OrgPermissionCache');
const {
  deriveDataScope,
  buildOrgTree,
  normalizeOrgImportRow,
  pickLatestSnapshot,
} = require('~/server/utils/orgDataScope');
const { queryTableRows } = require('~/server/services/DataSourceQueryService');

function getModels() {
  if (!OrgPermissionUnit || !OrgPermissionSettings) {
    throw new Error('OrgPermission models not initialized');
  }
  return { OrgPermissionUnit, OrgPermissionSettings };
}

function withDataScope(unit) {
  const obj = unit?.toObject ? unit.toObject() : { ...unit };
  return {
    ...obj,
    dataScope: deriveDataScope(obj.brchLv),
  };
}

async function replaceAllUnits(rows, source) {
  const { OrgPermissionUnit } = getModels();
  const importedAt = new Date();
  const docs = rows.map((row) => ({
    orgCode: row.orgCode,
    orgName: row.orgName || '',
    parentOrgCode: row.parentOrgCode,
    brchLv: row.brchLv,
    enabled: true,
    source,
    dataDt: row.dataDt || null,
    importedAt,
  }));

  await OrgPermissionUnit.deleteMany({});
  if (docs.length) {
    await OrgPermissionUnit.insertMany(docs, { ordered: false });
  }
  invalidateOrgPermissionCache();
  return docs.length;
}

async function listUnits(req, res) {
  try {
    const { OrgPermissionUnit } = getModels();
    const asTree = String(req.query.tree || '') === '1' || String(req.query.tree || '') === 'true';
    const units = await OrgPermissionUnit.find({}).sort({ orgCode: 1 }).lean();
    const enriched = units.map(withDataScope);
    if (asTree) {
      return res.json({ success: true, units: enriched, tree: buildOrgTree(enriched) });
    }
    return res.json({ success: true, units: enriched });
  } catch (error) {
    logger.error('[OrgPermission] listUnits failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function createUnit(req, res) {
  try {
    const { OrgPermissionUnit } = getModels();
    const { orgCode, orgName, parentOrgCode, brchLv, enabled } = req.body || {};
    if (!orgCode || String(orgCode).trim() === '') {
      return res.status(400).json({ success: false, error: 'orgCode 必填' });
    }
    const doc = await OrgPermissionUnit.create({
      orgCode: String(orgCode).trim(),
      orgName: orgName != null ? String(orgName).trim() : '',
      parentOrgCode:
        parentOrgCode == null || parentOrgCode === '' || parentOrgCode === '00000'
          ? null
          : String(parentOrgCode).trim(),
      brchLv: brchLv != null && brchLv !== '' ? Number(brchLv) : null,
      enabled: enabled !== false,
      source: 'manual',
    });
    invalidateOrgPermissionCache();
    return res.status(201).json({ success: true, unit: withDataScope(doc) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, error: '机构编码已存在' });
    }
    logger.error('[OrgPermission] createUnit failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function updateUnit(req, res) {
  try {
    const { OrgPermissionUnit } = getModels();
    const orgCode = decodeURIComponent(req.params.orgCode || '');
    const { orgName, parentOrgCode, brchLv, enabled } = req.body || {};
    const update = {};
    if (orgName !== undefined) update.orgName = String(orgName).trim();
    if (parentOrgCode !== undefined) {
      update.parentOrgCode =
        parentOrgCode == null || parentOrgCode === '' || parentOrgCode === '00000'
          ? null
          : String(parentOrgCode).trim();
    }
    if (brchLv !== undefined) {
      update.brchLv = brchLv == null || brchLv === '' ? null : Number(brchLv);
    }
    if (enabled !== undefined) update.enabled = Boolean(enabled);

    const doc = await OrgPermissionUnit.findOneAndUpdate(
      { orgCode },
      { $set: update },
      { new: true },
    );
    if (!doc) {
      return res.status(404).json({ success: false, error: '机构不存在' });
    }
    invalidateOrgPermissionCache();
    return res.json({ success: true, unit: withDataScope(doc) });
  } catch (error) {
    logger.error('[OrgPermission] updateUnit failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function deleteUnit(req, res) {
  try {
    const { OrgPermissionUnit } = getModels();
    const orgCode = decodeURIComponent(req.params.orgCode || '');
    const cascade = String(req.query.cascade || '') === '1' || String(req.query.cascade || '') === 'true';
    const existing = await OrgPermissionUnit.findOne({ orgCode }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, error: '机构不存在' });
    }

    if (cascade) {
      const all = await OrgPermissionUnit.find({}).lean();
      const toDelete = new Set([orgCode]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const u of all) {
          if (u.parentOrgCode && toDelete.has(String(u.parentOrgCode)) && !toDelete.has(u.orgCode)) {
            toDelete.add(u.orgCode);
            changed = true;
          }
        }
      }
      await OrgPermissionUnit.deleteMany({ orgCode: { $in: [...toDelete] } });
      invalidateOrgPermissionCache();
      return res.json({ success: true, deleted: [...toDelete] });
    }

    await OrgPermissionUnit.deleteOne({ orgCode });
    invalidateOrgPermissionCache();
    return res.json({ success: true, deleted: [orgCode] });
  } catch (error) {
    logger.error('[OrgPermission] deleteUnit failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function clearUnits(req, res) {
  try {
    const { OrgPermissionUnit } = getModels();
    const result = await OrgPermissionUnit.deleteMany({});
    invalidateOrgPermissionCache();
    return res.json({ success: true, deletedCount: result.deletedCount || 0 });
  } catch (error) {
    logger.error('[OrgPermission] clearUnits failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function importFromTable(req, res) {
  try {
    const { dataSourceId, tableName, limit } = req.body || {};
    if (!dataSourceId || !tableName) {
      return res.status(400).json({
        success: false,
        error: 'dataSourceId 与 tableName 必填',
      });
    }

    const rawRows = await queryTableRows({ dataSourceId, tableName, limit });
    const normalized = [];
    for (const row of rawRows) {
      const item = normalizeOrgImportRow(row);
      if (item) normalized.push(item);
    }
    if (!normalized.length) {
      return res.status(400).json({
        success: false,
        error: '未解析到有效机构行，请确认表含 brchno/orgCode 等列',
      });
    }

    const snapshot = pickLatestSnapshot(normalized);
    const count = await replaceAllUnits(snapshot, 'table');
    return res.json({
      success: true,
      imported: count,
      rawCount: rawRows.length,
      dataDt: snapshot[0]?.dataDt || null,
    });
  } catch (error) {
    logger.error('[OrgPermission] importFromTable failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function importFromExcel(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: '未收到文件，请上传 .xlsx' });
    }

    const XLSX = require('xlsx');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, error: 'Excel 为空' });
    }
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const normalized = [];
    for (const row of rawRows) {
      const item = normalizeOrgImportRow(row);
      if (item) normalized.push(item);
    }
    if (!normalized.length) {
      return res.status(400).json({
        success: false,
        error: '未解析到有效机构行，请确认表头含 data_dt/brchno/brchna/brchup/brchlv 或 orgCode/orgName/parentOrgCode/level',
      });
    }

    const snapshot = pickLatestSnapshot(normalized);
    const count = await replaceAllUnits(snapshot, 'excel');
    return res.json({
      success: true,
      imported: count,
      rawCount: rawRows.length,
      dataDt: snapshot[0]?.dataDt || null,
    });
  } catch (error) {
    logger.error('[OrgPermission] importFromExcel failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function getSettings(req, res) {
  try {
    const { OrgPermissionSettings } = getModels();
    let settings = await OrgPermissionSettings.findOne({ configId: 'default' }).lean();
    if (!settings) {
      settings = {
        configId: 'default',
        enforcementEnabled: false,
        sqlEnforcementEnabled: false,
      };
    }
    return res.json({ success: true, settings });
  } catch (error) {
    logger.error('[OrgPermission] getSettings failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function updateSettings(req, res) {
  try {
    const { OrgPermissionSettings } = getModels();
    const { enforcementEnabled, sqlEnforcementEnabled } = req.body || {};
    // 两个开关相互独立：只更新请求里显式传入的字段，避免一个开关的 PUT
    // 把另一个开关未携带的字段当成 undefined -> Boolean(undefined)=false 误清空。
    const update = { configId: 'default' };
    if (enforcementEnabled !== undefined) {
      update.enforcementEnabled = Boolean(enforcementEnabled);
    }
    if (sqlEnforcementEnabled !== undefined) {
      update.sqlEnforcementEnabled = Boolean(sqlEnforcementEnabled);
    }
    const settings = await OrgPermissionSettings.findOneAndUpdate(
      { configId: 'default' },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    invalidateOrgPermissionCache();
    return res.json({ success: true, settings });
  } catch (error) {
    logger.error('[OrgPermission] updateSettings failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  listUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  clearUnits,
  importFromTable,
  importFromExcel,
  getSettings,
  updateSettings,
};
