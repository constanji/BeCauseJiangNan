/**
 * ExcelCellAliasService — 指标/机构行别名
 * Mongo 按 entityId+filename+rowKey 持久化；同步写入 file_vectors 主列「别名」供检索优先命中。
 */

const mongoose = require('mongoose');
const { logger } = require('@because/data-schemas');

const ALIAS_COLUMN = '别名';
const ALIAS_SOURCE = 'excel_cell';

const KPI_FILENAME = '指标定义信息';
const ORG_FILENAME = '机构信息';

function getAliasModel() {
  if (mongoose.models.ExcelCellAlias) {
    return mongoose.models.ExcelCellAlias;
  }
  const schema = new mongoose.Schema(
    {
      entityId: { type: String, required: true, index: true },
      filename: { type: String, required: true, index: true },
      rowKey: { type: String, required: true },
      aliases: { type: [String], default: [] },
      displayName: { type: String, default: '' },
    },
    { timestamps: true, collection: 'excel_cell_aliases' },
  );
  schema.index({ entityId: 1, filename: 1, rowKey: 1 }, { unique: true });
  return mongoose.model('ExcelCellAlias', schema);
}

function normalizeAliases(aliases) {
  const seen = new Set();
  const out = [];
  for (const raw of aliases || []) {
    const a = String(raw || '').trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** 从 full_row 解析业务主键：指标编号 或 org_code */
function parseRowKey(fullRow) {
  const text = String(fullRow || '');
  const kpi = text.match(/(?:^|\|\s*)指标编号:\s*([^\s|]+)/);
  if (kpi) return kpi[1].trim();
  const org = text.match(/(?:^|\|\s*)org_code:\s*([^\s|]+)/i);
  if (org) return org[1].trim();
  return '';
}

function parseDisplayName(fullRow) {
  const text = String(fullRow || '');
  const std = text.match(/(?:^|\|\s*)标准名称:\s*([^|]+)/);
  if (std) return std[1].trim();
  const org = text.match(/(?:^|\|\s*)org_name:\s*([^|]+)/i);
  if (org) return org[1].trim();
  return '';
}

function isAliasCapableFilename(filename) {
  const name = String(filename || '').trim();
  return name === KPI_FILENAME || name === ORG_FILENAME;
}

/** 把别名段写入/替换进 full_row */
function upsertAliasInFullRow(fullRow, aliases) {
  const base = String(fullRow || '')
    .replace(/\s*\|\s*别名:\s*[^|]*/g, '')
    .trim()
    .replace(/\s*\|\s*$/, '')
    .trim();
  const list = normalizeAliases(aliases);
  if (!list.length) return base;
  const segment = `别名: ${list.join('；')}`;
  return base ? `${base} | ${segment}` : segment;
}

class ExcelCellAliasService {
  constructor(vectorSvc = null) {
    this.vectorSvc = vectorSvc;
  }

  async _ensureVector() {
    if (this.vectorSvc?.pool) return this.vectorSvc;
    const ExcelCellVectorizationService = require('./ExcelCellVectorizationService');
    this.vectorSvc = new ExcelCellVectorizationService();
    await this.vectorSvc.initialize();
    return this.vectorSvc;
  }

  async listAliases({ entityId, filename }) {
    const Alias = getAliasModel();
    const filter = { entityId: String(entityId) };
    if (filename) filter.filename = String(filename);
    const docs = await Alias.find(filter).lean();
    const map = {};
    for (const d of docs) {
      map[d.rowKey] = {
        rowKey: d.rowKey,
        aliases: d.aliases || [],
        displayName: d.displayName || '',
        filename: d.filename,
      };
    }
    return map;
  }

  async getAliasesForRowKeys({ entityId, filename, rowKeys }) {
    const keys = [...new Set((rowKeys || []).map((k) => String(k || '').trim()).filter(Boolean))];
    if (!keys.length) return {};
    const Alias = getAliasModel();
    const docs = await Alias.find({
      entityId: String(entityId),
      filename: String(filename),
      rowKey: { $in: keys },
    }).lean();
    const map = {};
    for (const d of docs) {
      map[d.rowKey] = d.aliases || [];
    }
    return map;
  }

  /**
   * 设置别名：Mongo upsert + 同步 file_vectors 主列「别名」
   */
  async setAliases({
    entityId,
    filename,
    fileId,
    rowKey,
    rowIndex,
    aliases,
    fullRow = '',
    userId = null,
    sheetName = 'Sheet1',
  }) {
    const key = String(rowKey || '').trim();
    if (!key) {
      throw Object.assign(new Error('rowKey 必填（指标编号或 org_code）'), { statusCode: 400 });
    }
    if (!isAliasCapableFilename(filename)) {
      throw Object.assign(new Error('仅支持「指标定义信息」或「机构信息」添加别名'), {
        statusCode: 400,
      });
    }

    const cleaned = normalizeAliases(aliases);
    const displayName = parseDisplayName(fullRow) || '';
    const Alias = getAliasModel();
    const sheet = String(sheetName || 'Sheet1');

    if (cleaned.length === 0) {
      await Alias.deleteOne({
        entityId: String(entityId),
        filename: String(filename),
        rowKey: key,
      });
    } else {
      await Alias.findOneAndUpdate(
        { entityId: String(entityId), filename: String(filename), rowKey: key },
        {
          $set: {
            aliases: cleaned,
            displayName,
          },
        },
        { upsert: true, new: true },
      );
    }

    if (fileId != null && rowIndex != null && rowIndex >= 0) {
      await this._syncAliasCells({
        entityId,
        fileId,
        filename,
        rowIndex: Number(rowIndex),
        aliases: cleaned,
        fullRow,
        userId,
        sheetName: sheet,
      });
    }

    logger.info(
      `[ExcelCellAliasService] setAliases entity=${entityId} file=${filename} key=${key} aliases=${cleaned.length} row=${rowIndex} sheet=${sheet}`,
    );
    return { rowKey: key, aliases: cleaned, displayName, sheetName: sheet };
  }

  async _deleteAliasCells({ entityId, fileId, rowIndex, sheetName }) {
    const svc = await this._ensureVector();
    await svc.pool.query(
      `DELETE FROM file_vectors
       WHERE file_id = $1
         AND entity_id = $2
         AND metadata->>'source' = $3
         AND metadata->>'column_name' = $4
         AND (metadata->>'row_index')::int = $5
         AND COALESCE(metadata->>'sheet_name', 'Sheet1') = $6`,
      [fileId, entityId, ALIAS_SOURCE, ALIAS_COLUMN, Number(rowIndex), String(sheetName || 'Sheet1')],
    );
  }

  async _updateRowFullRow({ entityId, fileId, rowIndex, sheetName, newFullRow }) {
    const svc = await this._ensureVector();
    await svc.pool.query(
      `UPDATE file_vectors
       SET metadata = jsonb_set(metadata, '{full_row}', to_jsonb($1::text), true)
       WHERE file_id = $2
         AND entity_id = $3
         AND metadata->>'source' = $4
         AND (metadata->>'row_index')::int = $5
         AND COALESCE(metadata->>'sheet_name', 'Sheet1') = $6`,
      [
        newFullRow,
        fileId,
        entityId,
        ALIAS_SOURCE,
        Number(rowIndex),
        String(sheetName || 'Sheet1'),
      ],
    );
  }

  async _syncAliasCells({
    entityId,
    fileId,
    filename,
    rowIndex,
    aliases,
    fullRow,
    userId,
    sheetName,
  }) {
    const svc = await this._ensureVector();
    const sheet = String(sheetName || 'Sheet1');
    await this._deleteAliasCells({ entityId, fileId, rowIndex, sheetName: sheet });

    const newFullRow = upsertAliasInFullRow(fullRow, aliases);
    await this._updateRowFullRow({
      entityId,
      fileId,
      rowIndex,
      sheetName: sheet,
      newFullRow,
    });

    if (!aliases.length) return;

    const maxRes = await svc.pool.query(
      `SELECT COALESCE(MAX(chunk_index), -1) AS max_idx
       FROM file_vectors WHERE file_id = $1 AND entity_id = $2`,
      [fileId, entityId],
    );
    let chunkIndex = Number(maxRes.rows[0]?.max_idx ?? -1) + 1;

    for (const alias of aliases) {
      let embedding = null;
      try {
        embedding = await svc.embeddingService.embedText(alias);
      } catch (e) {
        logger.warn(`[ExcelCellAliasService] embed 别名失败: ${e.message}`);
      }
      const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
      const metadata = {
        entity_id: entityId,
        filename,
        sheet_name: sheet,
        column_name: ALIAS_COLUMN,
        row_index: Number(rowIndex),
        full_row: newFullRow,
        source: ALIAS_SOURCE,
        is_primary_column: true,
        is_alias: true,
        row_key: parseRowKey(fullRow) || undefined,
      };
      await svc.pool.query(
        `INSERT INTO file_vectors
           (file_id, user_id, entity_id, chunk_index, content, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)`,
        [
          fileId,
          userId || null,
          entityId,
          chunkIndex++,
          alias,
          embeddingStr,
          JSON.stringify(metadata),
        ],
      );
    }
  }

  /**
   * 向量化结束后：按 Mongo 别名重写 file_vectors 中的「别名」主列
   */
  async reapplyAliasesForFile({ entityId, fileId, filename, userId = null }) {
    if (!isAliasCapableFilename(filename)) return { applied: 0 };

    const svc = await this._ensureVector();
    const rowRes = await svc.pool.query(
      `SELECT DISTINCT ON ((metadata->>'row_index')::int, COALESCE(metadata->>'sheet_name', 'Sheet1'))
         (metadata->>'row_index')::int AS row_index,
         metadata->>'full_row' AS full_row,
         COALESCE(metadata->>'sheet_name', 'Sheet1') AS sheet_name
       FROM file_vectors
       WHERE file_id = $1
         AND entity_id = $2
         AND metadata->>'source' = $3
         AND metadata->>'column_name' IS DISTINCT FROM $4
       ORDER BY (metadata->>'row_index')::int,
                COALESCE(metadata->>'sheet_name', 'Sheet1'),
                chunk_index`,
      [fileId, entityId, ALIAS_SOURCE, ALIAS_COLUMN],
    );

    const rows = rowRes.rows || [];
    const keyToMeta = new Map();
    for (const r of rows) {
      const rowKey = parseRowKey(r.full_row);
      if (!rowKey) continue;
      // 同一 rowKey 多 sheet 时保留首次；KPI/Org 通常单 sheet
      if (!keyToMeta.has(rowKey)) {
        keyToMeta.set(rowKey, {
          rowIndex: r.row_index,
          fullRow: r.full_row,
          sheetName: r.sheet_name || 'Sheet1',
        });
      }
    }

    const aliasMap = await this.getAliasesForRowKeys({
      entityId,
      filename,
      rowKeys: [...keyToMeta.keys()],
    });

    let applied = 0;
    for (const [rowKey, meta] of keyToMeta.entries()) {
      const aliases = aliasMap[rowKey] || [];
      if (!aliases.length) continue;
      await this._syncAliasCells({
        entityId,
        fileId,
        filename,
        rowIndex: meta.rowIndex,
        aliases,
        fullRow: meta.fullRow,
        userId,
        sheetName: meta.sheetName,
      });
      applied += 1;
    }

    logger.info(
      `[ExcelCellAliasService] reapplyAliases fileId=${fileId} filename=${filename} applied=${applied}`,
    );
    return { applied };
  }

  /**
   * 预览查询：服务端按 q / aliasFilter 过滤后再截断，避免「先 LIMIT 再过滤」漏行
   */
  async queryPreviewRows({
    entityId,
    fileId,
    filename,
    q = '',
    aliasFilter = 'all',
    limit = 500,
  }) {
    const svc = await this._ensureVector();
    const query = String(q || '').trim().toLowerCase();
    const filter = String(aliasFilter || 'all').toLowerCase();
    const needFullScan = Boolean(query) || filter === 'has' || filter === 'none';
    // 有筛选时先拉足够多行再过滤；无筛选时按 limit
    const fetchLimit = needFullScan ? Math.max(Number(limit) || 500, 20000) : Number(limit) || 500;

    const rowRes = await svc.pool.query(
      `SELECT DISTINCT ON ((metadata->>'row_index')::int, COALESCE(metadata->>'sheet_name', 'Sheet1'))
         (metadata->>'row_index')::int AS row_index,
         metadata->>'full_row' AS full_row,
         COALESCE(metadata->>'sheet_name', 'Sheet1') AS sheet_name
       FROM file_vectors
       WHERE file_id = $1
         AND entity_id = $2
         AND metadata->>'source' = $3
         AND metadata->>'column_name' IS DISTINCT FROM $4
       ORDER BY (metadata->>'row_index')::int,
                COALESCE(metadata->>'sheet_name', 'Sheet1'),
                chunk_index
       LIMIT $5`,
      [fileId, entityId, ALIAS_SOURCE, ALIAS_COLUMN, fetchLimit],
    );

    const rows = (rowRes.rows || []).map((r) => ({
      rowIndex: r.row_index,
      fullRow: r.full_row || '',
      sheetName: r.sheet_name || 'Sheet1',
      rowKey: parseRowKey(r.full_row || ''),
      aliases: [],
    }));

    let aliasMap = {};
    if (isAliasCapableFilename(filename)) {
      const needAllAliases = Boolean(query) || filter === 'has';
      if (needAllAliases) {
        // q / 有别名：拉 Mongo 全量别名，避免只挂在 fetchLimit 窗口内的行上
        const allAlias = await this.listAliases({ entityId, filename });
        for (const [k, v] of Object.entries(allAlias)) {
          aliasMap[k] = v.aliases || [];
        }
      } else {
        aliasMap = await this.getAliasesForRowKeys({
          entityId,
          filename,
          rowKeys: rows.map((r) => r.rowKey).filter(Boolean),
        });
      }
    }

    for (const row of rows) {
      row.aliases = row.rowKey ? aliasMap[row.rowKey] || [] : [];
    }

    const filtered = this._filterEnrichedRows(rows, query, filter);

    // 回表补行：有别名筛选，或搜索词命中别名但原行不在 fetchLimit 窗口
    if (isAliasCapableFilename(filename) && Object.keys(aliasMap).length) {
      const present = new Set(filtered.map((r) => r.rowKey).filter(Boolean));
      let missingKeys = [];

      if (filter === 'has') {
        missingKeys = Object.keys(aliasMap).filter(
          (k) => (aliasMap[k] || []).length > 0 && !present.has(k),
        );
      }

      if (query) {
        const aliasHitKeys = Object.keys(aliasMap).filter((k) => {
          const list = aliasMap[k] || [];
          if (!list.length || present.has(k)) return false;
          return list.some((a) => String(a).toLowerCase().includes(query));
        });
        missingKeys = [...new Set([...missingKeys, ...aliasHitKeys])];
      }

      if (missingKeys.length) {
        const extra = await this._fetchRowsByRowKeys({
          entityId,
          fileId,
          rowKeys: missingKeys.slice(0, Math.max(Number(limit) || 500, 200)),
        });
        for (const row of extra) {
          row.aliases = row.rowKey ? aliasMap[row.rowKey] || [] : [];
          // 再过一遍筛选（aliasFilter=none 时不应补入有别名行；q 已由 alias 命中保证）
          const pass = this._filterEnrichedRows([row], query, filter);
          if (!pass.length) continue;
          if (!filtered.some((f) => f.rowKey === row.rowKey && f.sheetName === row.sheetName)) {
            filtered.push(row);
          }
        }
      }
    }

    const sliced = filtered.slice(0, Number(limit) || 500);
    return {
      rows: sliced,
      totalMatched: filtered.length,
      truncated: filtered.length > sliced.length,
    };
  }

  async _fetchRowsByRowKeys({ entityId, fileId, rowKeys }) {
    if (!rowKeys?.length) return [];
    const svc = await this._ensureVector();
    // full_row 含「指标编号: KEY」或「org_code: KEY」
    const patterns = rowKeys.map((k) => `%${k}%`);
    const result = await svc.pool.query(
      `SELECT DISTINCT ON ((metadata->>'row_index')::int, COALESCE(metadata->>'sheet_name', 'Sheet1'))
         (metadata->>'row_index')::int AS row_index,
         metadata->>'full_row' AS full_row,
         COALESCE(metadata->>'sheet_name', 'Sheet1') AS sheet_name
       FROM file_vectors
       WHERE file_id = $1
         AND entity_id = $2
         AND metadata->>'source' = $3
         AND metadata->>'column_name' IS DISTINCT FROM $4
         AND metadata->>'full_row' ILIKE ANY($5::text[])
       ORDER BY (metadata->>'row_index')::int,
                COALESCE(metadata->>'sheet_name', 'Sheet1'),
                chunk_index`,
      [fileId, entityId, ALIAS_SOURCE, ALIAS_COLUMN, patterns],
    );
    return (result.rows || [])
      .map((r) => ({
        rowIndex: r.row_index,
        fullRow: r.full_row || '',
        sheetName: r.sheet_name || 'Sheet1',
        rowKey: parseRowKey(r.full_row || ''),
        aliases: [],
      }))
      .filter((r) => r.rowKey && rowKeys.includes(r.rowKey));
  }

  /**
   * 丰富预览行：附加 rowKey / aliases，并按 q / aliasFilter 过滤
   * @deprecated 优先用 queryPreviewRows，避免先 LIMIT 再过滤
   */
  async enrichFileRows({
    entityId,
    filename,
    rows,
    q = '',
    aliasFilter = 'all',
  }) {
    const parsed = (rows || []).map((r) => {
      const fullRow = r.fullRow || r.full_row || '';
      const rowKey = parseRowKey(fullRow);
      return {
        rowIndex: r.rowIndex ?? r.row_index,
        fullRow,
        sheetName: r.sheetName || r.sheet_name || 'Sheet1',
        rowKey,
        aliases: [],
      };
    });

    if (!isAliasCapableFilename(filename)) {
      return this._filterEnrichedRows(parsed, q, aliasFilter);
    }

    const aliasMap = await this.getAliasesForRowKeys({
      entityId,
      filename,
      rowKeys: parsed.map((r) => r.rowKey).filter(Boolean),
    });
    for (const row of parsed) {
      row.aliases = row.rowKey ? aliasMap[row.rowKey] || [] : [];
    }
    return this._filterEnrichedRows(parsed, q, aliasFilter);
  }

  _filterEnrichedRows(rows, q, aliasFilter) {
    const query = String(q || '').trim().toLowerCase();
    const filter = String(aliasFilter || 'all').toLowerCase();
    return rows.filter((r) => {
      if (filter === 'has' && !(r.aliases && r.aliases.length)) return false;
      if (filter === 'none' && r.aliases && r.aliases.length) return false;
      if (query) {
        const hay = `${r.fullRow} ${(r.aliases || []).join(' ')} ${r.rowKey || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }

  /** 给检索结果附上 aliases / rowKey / matchedViaAlias */
  async attachAliasesToSearchResults({ entityId, filename, results }) {
    if (!results?.length) return results || [];
    const effectiveFilename =
      filename ||
      results.find((r) => isAliasCapableFilename(r.filename))?.filename ||
      results[0]?.filename;

    const enriched = results.map((r) => {
      const rowKey = parseRowKey(r.fullRow);
      return {
        ...r,
        rowKey,
        matchedViaAlias: String(r.columnName || '') === ALIAS_COLUMN,
        aliases: [],
      };
    });

    if (!isAliasCapableFilename(effectiveFilename)) {
      return enriched;
    }

    const aliasMap = await this.getAliasesForRowKeys({
      entityId,
      filename: effectiveFilename,
      rowKeys: enriched.map((r) => r.rowKey).filter(Boolean),
    });
    for (const r of enriched) {
      r.aliases = r.rowKey ? aliasMap[r.rowKey] || [] : [];
    }
    return enriched;
  }
}

module.exports = ExcelCellAliasService;
module.exports.ALIAS_COLUMN = ALIAS_COLUMN;
module.exports.parseRowKey = parseRowKey;
module.exports.parseDisplayName = parseDisplayName;
module.exports.normalizeAliases = normalizeAliases;
module.exports.upsertAliasInFullRow = upsertAliasInFullRow;
module.exports.isAliasCapableFilename = isAliasCapableFilename;
module.exports.KPI_FILENAME = KPI_FILENAME;
module.exports.ORG_FILENAME = ORG_FILENAME;
