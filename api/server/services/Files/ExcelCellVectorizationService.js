/**
 * ExcelCellVectorizationService
 *
 * 将 Excel 文件按单元格向量化并写入 file_vectors 表：
 * - 每个非空单元格独立 embed（精准检索）
 * - metadata.full_row 保存整行序列化文本（命中后返回整行）
 * - 支持多 sheet、多文件、datasource 隔离
 * - 支持主列（高优先级）与排除列（不参与检索）
 */

const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const { logger } = require('@because/data-schemas');
const {
  buildColumnSet,
  parseWorkbookHeaders,
  computeTextMatchScore,
  applyVectorColumnWeight,
  parseMetadataFlag,
  formatSearchRow,
  mergeSearchResults,
  buildFullRow,
} = require('./ExcelColumnSearchUtils');

const BATCH_SIZE = 20;

class ExcelCellVectorizationService {
  constructor() {
    this.pool = null;
    this.embeddingService = null;
  }

  async initialize() {
    if (this.pool) return;

    const VectorDBService = require('~/server/services/RAG/VectorDBService');
    const EmbeddingService = require('~/server/services/RAG/EmbeddingService');

    const vectorDB = new VectorDBService();
    await vectorDB.initialize();
    this.pool = vectorDB.getPool();

    this.embeddingService = new EmbeddingService();
  }

  /**
   * 解析 xlsx 表头（首行），供上传前配置列
   */
  parseHeaders(fileBufferOrPath) {
    const buffer = Buffer.isBuffer(fileBufferOrPath)
      ? fileBufferOrPath
      : require('fs').readFileSync(fileBufferOrPath);
    return parseWorkbookHeaders(buffer);
  }

  /**
   * 写入文件级列配置（不参与检索）
   */
  async saveFileConfig({
    fileId,
    entityId,
    userId,
    filename,
    primaryColumns,
    excludedColumns,
    headers,
    sheetNames,
    dataDt = null,
  }) {
    await this.initialize();
    const metadata = {
      source: 'excel_file_config',
      entity_id: entityId,
      filename,
      primary_columns: primaryColumns || [],
      excluded_columns: excludedColumns || [],
      headers: headers || [],
      sheet_names: sheetNames || [],
      data_dt: dataDt || null,
    };

    await this.pool.query(
      `INSERT INTO file_vectors
         (file_id, user_id, entity_id, chunk_index, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb)`,
      [fileId, userId || null, entityId || null, -1, '__file_config__', JSON.stringify(metadata)],
    );
  }

  /**
   * 将表头+行数据向量化写入 file_vectors（Excel 上传与表抽取共用）
   * @param {object} opts
   * @param {string} opts.entityId
   * @param {string} [opts.userId]
   * @param {string} [opts.fileId] 稳定 fileId；同类型覆盖时传入并设 replaceExisting
   * @param {string} opts.filename
   * @param {string[]} opts.headers
   * @param {Array<Record<string, any>|any[]>} opts.rows
   * @param {string[]} [opts.primaryColumns]
   * @param {string[]} [opts.excludedColumns]
   * @param {string} [opts.sheetName]
   * @param {boolean} [opts.replaceExisting] 写入前按 fileId+entityId 删除旧数据
   */
  async vectorizeFromRows({
    entityId,
    userId,
    fileId: providedFileId,
    filename,
    headers,
    rows = [],
    primaryColumns = [],
    excludedColumns = [],
    sheetName = 'Sheet1',
    replaceExisting = false,
    dataDt = null,
  }) {
    await this.initialize();

    const cleanHeaders = (headers || []).map((h) => String(h).trim()).filter(Boolean);
    if (!cleanHeaders.length) {
      throw Object.assign(new Error('headers 不能为空'), { statusCode: 400 });
    }

    const fileId = providedFileId || uuidv4();
    if (replaceExisting && providedFileId) {
      await this.deleteByFileId(fileId, entityId);
    }

    const arrayRows = (rows || []).map((row) => {
      if (Array.isArray(row)) return row;
      return cleanHeaders.map((h) => (row && row[h] != null ? row[h] : ''));
    });

    const cellCount = await this._writeCellBatches({
      fileId,
      entityId,
      userId,
      filename,
      headers: cleanHeaders,
      dataRows: arrayRows,
      sheetName,
      primaryColumns,
      excludedColumns,
      chunkIndexOffset: 0,
    });

    await this.saveFileConfig({
      fileId,
      entityId,
      userId,
      filename,
      primaryColumns,
      excludedColumns,
      headers: cleanHeaders,
      sheetNames: [sheetName],
      dataDt,
    });

    logger.info(
      `[ExcelCellVectorizationService] vectorizeFromRows 完成：fileId=${fileId}, rows=${arrayRows.length}, cells=${cellCount}`,
    );

    return {
      fileId,
      rowCount: arrayRows.length,
      cellCount,
      sheetNames: [sheetName],
      primaryColumns,
      excludedColumns,
      headers: cleanHeaders,
      filename,
      dataDt: dataDt || null,
    };
  }

  /**
   * 内部：按单元格批次 embed 并 INSERT
   */
  async _writeCellBatches({
    fileId,
    entityId,
    userId,
    filename,
    headers,
    dataRows,
    sheetName,
    primaryColumns,
    excludedColumns,
    chunkIndexOffset = 0,
  }) {
    const primarySet = buildColumnSet(primaryColumns);
    const excludedSet = buildColumnSet(excludedColumns);

    logger.info(
      `[ExcelCellVectorizationService] Sheet "${sheetName}": ${dataRows.length} 行, ${headers.length} 列, 主列=[${primaryColumns.join(', ')}], 排除列=[${excludedColumns.join(', ')}]`,
    );

    const cells = [];
    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx];
      const fullRow = buildFullRow(headers, row);

      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const colName = headers[colIdx];
        const colKey = colName.trim().toLowerCase();
        if (excludedSet.has(colKey)) continue;

        const cellValue = String(row[colIdx] ?? '').trim();
        if (!cellValue) continue;

        const isPrimary = primarySet.size > 0 && primarySet.has(colKey);
        cells.push({
          content: cellValue,
          colName,
          rowIdx,
          fullRow,
          sheetName,
          isPrimary,
        });
      }
    }

    for (let batchStart = 0; batchStart < cells.length; batchStart += BATCH_SIZE) {
      const batch = cells.slice(batchStart, batchStart + BATCH_SIZE);

      await Promise.all(
        batch.map(async (cell, batchOffset) => {
          let embedding = null;
          try {
            embedding = await this.embeddingService.embedText(cell.content);
          } catch (e) {
            logger.warn(`[ExcelCellVectorizationService] embed 失败，跳过单元格: ${e.message}`);
          }

          const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
          const metadata = {
            entity_id: entityId,
            filename,
            sheet_name: cell.sheetName,
            column_name: cell.colName,
            row_index: cell.rowIdx,
            full_row: cell.fullRow,
            source: 'excel_cell',
            is_primary_column: cell.isPrimary || false,
            primary_columns: primaryColumns,
            excluded_columns: excludedColumns,
          };

          await this.pool.query(
            `INSERT INTO file_vectors
               (file_id, user_id, entity_id, chunk_index, content, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)`,
            [
              fileId,
              userId || null,
              entityId || null,
              chunkIndexOffset + batchStart + batchOffset,
              cell.content,
              embeddingStr,
              JSON.stringify(metadata),
            ],
          );
        }),
      );

      logger.info(
        `[ExcelCellVectorizationService] 已处理 ${Math.min(batchStart + BATCH_SIZE, cells.length)}/${cells.length} 个单元格`,
      );
    }

    return cells.length;
  }

  /**
   * 解析 xlsx 文件并向量化所有单元格
   */
  async vectorize({
    fileBufferOrPath,
    entityId,
    userId,
    filename,
    sheetName,
    primaryColumns = [],
    excludedColumns = [],
  }) {
    await this.initialize();

    const fileId = uuidv4();

    let workbook;
    if (Buffer.isBuffer(fileBufferOrPath)) {
      workbook = XLSX.read(fileBufferOrPath, { type: 'buffer' });
    } else {
      workbook = XLSX.readFile(fileBufferOrPath);
    }

    const sheetsToProcess = sheetName ? [sheetName] : workbook.SheetNames;
    let totalRowCount = 0;
    let totalCellCount = 0;
    const allHeaders = [];
    let chunkOffset = 0;

    for (const sName of sheetsToProcess) {
      const sheet = workbook.Sheets[sName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rows || rows.length < 2) continue;

      const headers = rows[0].map((h) => String(h).trim());
      allHeaders.push(...headers);
      const dataRows = rows.slice(1);
      totalRowCount += dataRows.length;

      const cellCount = await this._writeCellBatches({
        fileId,
        entityId,
        userId,
        filename,
        headers,
        dataRows,
        sheetName: sName,
        primaryColumns,
        excludedColumns,
        chunkIndexOffset: chunkOffset,
      });
      totalCellCount += cellCount;
      chunkOffset += cellCount;
    }

    const uniqueHeaders = [...new Set(allHeaders.filter(Boolean))];
    await this.saveFileConfig({
      fileId,
      entityId,
      userId,
      filename,
      primaryColumns,
      excludedColumns,
      headers: uniqueHeaders,
      sheetNames: sheetsToProcess,
    });

    logger.info(
      `[ExcelCellVectorizationService] 完成：fileId=${fileId}, rows=${totalRowCount}, cells=${totalCellCount}`,
    );

    return {
      fileId,
      rowCount: totalRowCount,
      cellCount: totalCellCount,
      sheetNames: sheetsToProcess,
      primaryColumns,
      excludedColumns,
      headers: uniqueHeaders,
    };
  }

  async deleteByFileId(fileId, entityId) {
    await this.initialize();
    const result = await this.pool.query(
      'DELETE FROM file_vectors WHERE file_id = $1 AND entity_id = $2',
      [fileId, entityId],
    );
    return result.rowCount;
  }

  async fileExistsInEntity(fileId, entityId) {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT 1 FROM file_vectors
       WHERE file_id = $1 AND entity_id = $2
       LIMIT 1`,
      [fileId, entityId],
    );
    return result.rows.length > 0;
  }

  async listByEntityId(entityId) {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT
         file_id,
         metadata->>'filename'   AS filename,
         metadata->>'sheet_name' AS sheet_name,
         COUNT(*)                AS cell_count,
         MAX((metadata->>'row_index')::int) + 1 AS row_count,
         MIN(created_at)         AS created_at
       FROM file_vectors
       WHERE entity_id = $1
         AND metadata->>'source' = 'excel_cell'
       GROUP BY file_id, metadata->>'filename', metadata->>'sheet_name'
       ORDER BY MIN(created_at) DESC`,
      [entityId],
    );

    const configResult = await this.pool.query(
      `SELECT file_id, metadata
       FROM file_vectors
       WHERE entity_id = $1
         AND metadata->>'source' = 'excel_file_config'`,
      [entityId],
    );
    const configMap = {};
    for (const row of configResult.rows) {
      configMap[row.file_id] = row.metadata || {};
    }

    const fileMap = {};
    for (const row of result.rows) {
      if (!fileMap[row.file_id]) {
        const cfg = configMap[row.file_id] || {};
        fileMap[row.file_id] = {
          fileId: row.file_id,
          filename: row.filename || 'unknown',
          cellCount: 0,
          rowCount: 0,
          createdAt: row.created_at,
          primaryColumns: cfg.primary_columns || [],
          excludedColumns: cfg.excluded_columns || [],
          headers: cfg.headers || [],
          dataDt: cfg.data_dt || null,
        };
      }
      fileMap[row.file_id].cellCount += parseInt(row.cell_count, 10);
      fileMap[row.file_id].rowCount += parseInt(row.row_count, 10) || 0;
    }

    return Object.values(fileMap);
  }

  async getFileRows(fileId, entityId, limit = 200) {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT DISTINCT ON ((metadata->>'row_index')::int, metadata->>'sheet_name')
         (metadata->>'row_index')::int AS row_index,
         metadata->>'full_row'         AS full_row,
         metadata->>'sheet_name'       AS sheet_name
       FROM file_vectors
       WHERE file_id = $1
         AND entity_id = $2
         AND metadata->>'source' = 'excel_cell'
       ORDER BY (metadata->>'row_index')::int, metadata->>'sheet_name'
       LIMIT $3`,
      [fileId, entityId, limit],
    );
    return result.rows.map((r) => ({
      rowIndex: r.row_index,
      fullRow: r.full_row,
      sheetName: r.sheet_name,
    }));
  }

  /**
   * 规范化文件名过滤条件。
   * 支持：精确匹配（大小写不敏感）、无扩展名时匹配 org_master → org_master.xlsx
   * @returns {string|null}
   */
  normalizeFilenameFilter(filename) {
    if (filename == null) return null;
    const trimmed = String(filename).trim();
    return trimmed || null;
  }

  /**
   * 追加 filename 过滤到 SQL（大小写不敏感；无扩展名时允许匹配同名 .xlsx/.xls）
   * @returns {{ sql: string, params: any[] }}
   */
  appendFilenameFilter(sql, params, filename) {
    const name = this.normalizeFilenameFilter(filename);
    if (!name) return { sql, params };

    const nextParams = [...params, name];
    const idx = nextParams.length;
    // 精确匹配，或传入无扩展名时匹配「basename.任意扩展名」
    const clause = ` AND (
      LOWER(TRIM(metadata->>'filename')) = LOWER(TRIM($${idx}))
      OR (
        POSITION('.' IN TRIM($${idx})) = 0
        AND LOWER(TRIM(metadata->>'filename')) LIKE LOWER(TRIM($${idx})) || '.%'
      )
    )`;
    return { sql: sql + clause, params: nextParams };
  }

  /**
   * 文本精确匹配：支持主列优先、排除列（索引阶段已跳过）、可选按文件名限定
   */
  async searchTextMatches({ entityId, query, topK, primaryOnly = false, filename = null }) {
    let sql = `SELECT content, metadata
               FROM file_vectors
               WHERE entity_id = $1
                 AND metadata->>'source' = 'excel_cell'
                 AND content ILIKE $2`;
    let params = [entityId, `%${query}%`];

    if (primaryOnly) {
      sql += ` AND (metadata->>'is_primary_column' = 'true')`;
    }

    ({ sql, params } = this.appendFilenameFilter(sql, params, filename));

    sql += ` LIMIT $${params.length + 1}`;
    params.push(topK * 5);

    const textResult = await this.pool.query(sql, params);
    return textResult.rows;
  }

  /**
   * 拉取全部主列单元格（不做 ILIKE 字面过滤）。
   * 主列数据量通常有限（机构/指标主档），全量拉取后交给 JS 侧做精确/包含/有序子序列模糊评分，
   * 避免 SQL ILIKE 要求连续子串导致漏掉"溧阳支行"命中"溧阳市支行"这类中间插字场景
   * （ILIKE '%溧阳支行%' 永远匹配不到"溧阳市支行"，因为字面上不是连续子串）。
   */
  async fetchAllPrimaryColumnCells({ entityId, limit = 5000, filename = null }) {
    let sql = `SELECT content, metadata
               FROM file_vectors
               WHERE entity_id = $1
                 AND metadata->>'source' = 'excel_cell'
                 AND metadata->>'is_primary_column' = 'true'`;
    let params = [entityId];
    ({ sql, params } = this.appendFilenameFilter(sql, params, filename));
    sql += ` LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  /**
   * 语义检索 Excel 单元格
   * @param {Object} opts
   * @param {string} [opts.filename] - 可选；指定后仅在该 Excel 文件内检索（大小写不敏感）
   */
  async search({ entityId, query, topK = 10, minScore = 0.5, filename = null }) {
    await this.initialize();

    const filenameFilter = this.normalizeFilenameFilter(filename);

    let primaryCheckSql = `SELECT 1 FROM file_vectors
       WHERE entity_id = $1
         AND metadata->>'source' = 'excel_cell'
         AND metadata->>'is_primary_column' = 'true'`;
    let primaryCheckParams = [entityId];
    ({ sql: primaryCheckSql, params: primaryCheckParams } = this.appendFilenameFilter(
      primaryCheckSql,
      primaryCheckParams,
      filenameFilter,
    ));
    primaryCheckSql += ' LIMIT 1';

    const hasPrimaryConfig = await this.pool.query(primaryCheckSql, primaryCheckParams);
    const usePrimaryBoost = hasPrimaryConfig.rows.length > 0;

    const mapTextRows = (rows, { isPrimary } = {}) =>
      rows
        .map((r) => {
          const rowIsPrimary = isPrimary ?? parseMetadataFlag(r.metadata?.is_primary_column);
          const score = computeTextMatchScore({
            query,
            cellValue: r.content,
            isPrimaryColumn: rowIsPrimary,
            hasPrimaryConfig: usePrimaryBoost,
          });
          if (score == null) return null;
          const formatted = formatSearchRow(r, score);
          formatted.isExactMatch = String(r.content).trim().toLowerCase() === String(query).trim().toLowerCase();
          return formatted;
        })
        .filter(Boolean);

    let textRows;
    if (usePrimaryBoost) {
      // 主列走全量拉取 + JS 评分（精确/包含/有序子序列模糊），不受 ILIKE 连续子串限制
      const primaryCells = await this.fetchAllPrimaryColumnCells({
        entityId,
        filename: filenameFilter,
      });
      textRows = mapTextRows(primaryCells, { isPrimary: true }).sort((a, b) => b.score - a.score);

      if (textRows.length < topK) {
        const primaryKeys = new Set(
          textRows.map((r) => `${r.filename}::${r.sheetName}::${r.rowIndex}::${r.columnName}`),
        );
        const fallbackRows = mapTextRows(
          await this.searchTextMatches({
            entityId,
            query,
            topK,
            primaryOnly: false,
            filename: filenameFilter,
          }),
        ).filter((r) => !primaryKeys.has(`${r.filename}::${r.sheetName}::${r.rowIndex}::${r.columnName}`));
        textRows = [...textRows, ...fallbackRows];
      }
    } else {
      textRows = mapTextRows(
        await this.searchTextMatches({
          entityId,
          query,
          topK,
          primaryOnly: false,
          filename: filenameFilter,
        }),
      );
    }

    let vectorRows = [];
    const queryEmbedding = await this.embeddingService.embedText(query);
    if (queryEmbedding) {
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      let vectorSql = `SELECT content, metadata, 1 - (embedding <=> $1::vector) AS score
                       FROM file_vectors
                       WHERE entity_id = $2
                         AND metadata->>'source' = 'excel_cell'
                         AND embedding IS NOT NULL
                         AND 1 - (embedding <=> $1::vector) >= $3`;
      let vectorParams = [embeddingStr, entityId, minScore];

      if (usePrimaryBoost) {
        vectorSql += ` AND (metadata->>'is_primary_column' = 'true')`;
      }

      ({ sql: vectorSql, params: vectorParams } = this.appendFilenameFilter(
        vectorSql,
        vectorParams,
        filenameFilter,
      ));

      vectorSql += ` ORDER BY embedding <=> $1::vector LIMIT $${vectorParams.length + 1}`;
      vectorParams.push(topK * 3);

      const vectorResult = await this.pool.query(vectorSql, vectorParams);
      vectorRows = vectorResult.rows.map((r) => {
        const isPrimary = parseMetadataFlag(r.metadata?.is_primary_column);
        const weighted = applyVectorColumnWeight(parseFloat(r.score), isPrimary, usePrimaryBoost);
        return formatSearchRow(r, weighted);
      });

      if (usePrimaryBoost && vectorRows.length < topK) {
        let fallbackSql = `SELECT content, metadata, 1 - (embedding <=> $1::vector) AS score
           FROM file_vectors
           WHERE entity_id = $2
             AND metadata->>'source' = 'excel_cell'
             AND embedding IS NOT NULL
             AND 1 - (embedding <=> $1::vector) >= $3`;
        let fallbackParams = [embeddingStr, entityId, minScore];
        ({ sql: fallbackSql, params: fallbackParams } = this.appendFilenameFilter(
          fallbackSql,
          fallbackParams,
          filenameFilter,
        ));
        fallbackSql += ` ORDER BY embedding <=> $1::vector LIMIT $${fallbackParams.length + 1}`;
        fallbackParams.push(topK * 3);

        const fallbackResult = await this.pool.query(fallbackSql, fallbackParams);
        const extra = fallbackResult.rows.map((r) => {
          const isPrimary = parseMetadataFlag(r.metadata?.is_primary_column);
          const weighted = applyVectorColumnWeight(parseFloat(r.score), isPrimary, usePrimaryBoost);
          return formatSearchRow(r, weighted);
        });
        vectorRows = [...vectorRows, ...extra];
      }
    }

    return mergeSearchResults({
      textRows,
      vectorRows,
      topK,
      hasPrimaryConfig: usePrimaryBoost,
    });
  }
}

module.exports = ExcelCellVectorizationService;
