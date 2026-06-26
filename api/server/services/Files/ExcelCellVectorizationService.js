/**
 * ExcelCellVectorizationService
 *
 * 将 Excel 文件按单元格向量化并写入 file_vectors 表：
 * - 每个非空单元格独立 embed（精准检索）
 * - metadata.full_row 保存整行序列化文本（命中后返回整行）
 * - 支持多 sheet、多文件、datasource 隔离
 */

const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const { logger } = require('@because/data-schemas');

const BATCH_SIZE = 20; // 每批并发向量化的单元格数

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
   * 解析 xlsx 文件并向量化所有单元格
   * @param {Buffer|string} fileBufferOrPath  文件 Buffer 或本地路径
   * @param {string}        entityId          数据源 ID（用于隔离）
   * @param {string}        userId            用户 ID
   * @param {string}        filename          原始文件名（存入 metadata）
   * @param {string}        [sheetName]       指定 sheet，默认处理所有 sheet
   * @returns {{ fileId: string, rowCount: number, cellCount: number, sheetNames: string[] }}
   */
  async vectorize({ fileBufferOrPath, entityId, userId, filename, sheetName, primaryColumns = [] }) {
    await this.initialize();

    const fileId = uuidv4();

    let workbook;
    if (Buffer.isBuffer(fileBufferOrPath)) {
      workbook = XLSX.read(fileBufferOrPath, { type: 'buffer' });
    } else {
      workbook = XLSX.readFile(fileBufferOrPath);
    }

    const sheetsToProcess = sheetName
      ? [sheetName]
      : workbook.SheetNames;

    let totalRowCount = 0;
    let totalCellCount = 0;

    for (const sName of sheetsToProcess) {
      const sheet = workbook.Sheets[sName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rows || rows.length < 2) continue; // 至少有 header + 1 行数据

      const headers = rows[0].map((h) => String(h).trim());
      const dataRows = rows.slice(1);
      totalRowCount += dataRows.length;

      // 主检索列名集合（不区分大小写）
      const primarySet = new Set(primaryColumns.map((c) => c.trim().toLowerCase()));

      logger.info(
        `[ExcelCellVectorizationService] Sheet "${sName}": ${dataRows.length} 行, ${headers.length} 列, 主列: [${[...primarySet].join(', ')}]`,
      );

      // 遍历每行每列，收集待向量化的单元格
      const cells = [];
      for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
        const row = dataRows[rowIdx];

        // 整行序列化（用于返回全行上下文）
        const fullRow = headers
          .map((h, colIdx) => `${h}: ${String(row[colIdx] ?? '').trim()}`)
          .filter((seg) => !seg.endsWith(': '))
          .join(' | ');

        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
          const cellValue = String(row[colIdx] ?? '').trim();
          if (!cellValue) continue; // 跳过空单元格

          const isPrimary = primarySet.size > 0 && primarySet.has(headers[colIdx].trim().toLowerCase());

          cells.push({
            content: cellValue,
            colName: headers[colIdx],
            rowIdx,
            fullRow,
            sheetName: sName,
            isPrimary,
          });
        }
      }

      // 分批向量化写入
      for (let batchStart = 0; batchStart < cells.length; batchStart += BATCH_SIZE) {
        const batch = cells.slice(batchStart, batchStart + BATCH_SIZE);

        await Promise.all(
          batch.map(async (cell, batchOffset) => {
            const chunkIndex = (cell.rowIdx * headers.length) + cells.indexOf(cell);

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
            };

            await this.pool.query(
              `INSERT INTO file_vectors
                 (file_id, user_id, entity_id, chunk_index, content, embedding, metadata)
               VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)`,
              [
                fileId,
                userId || null,
                entityId || null,
                batchStart + batchOffset,
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

      totalCellCount += cells.length;
    }

    logger.info(
      `[ExcelCellVectorizationService] 完成：fileId=${fileId}, rows=${totalRowCount}, cells=${totalCellCount}`,
    );

    return {
      fileId,
      rowCount: totalRowCount,
      cellCount: totalCellCount,
      sheetNames: sheetsToProcess,
    };
  }

  /**
   * 删除指定 file_id 的所有向量记录
   * @param {string} fileId
   */
  async deleteByFileId(fileId) {
    await this.initialize();
    const result = await this.pool.query(
      'DELETE FROM file_vectors WHERE file_id = $1',
      [fileId],
    );
    return result.rowCount;
  }

  /**
   * 列出指定 datasource 下的所有 Excel 文件（按 file_id 聚合）
   * @param {string} entityId
   * @returns {Array<{ fileId, filename, cellCount, rowCount, createdAt }>}
   */
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

    // 合并同 file_id 的多个 sheet
    const fileMap = {};
    for (const row of result.rows) {
      if (!fileMap[row.file_id]) {
        fileMap[row.file_id] = {
          fileId: row.file_id,
          filename: row.filename || 'unknown',
          cellCount: 0,
          rowCount: 0,
          createdAt: row.created_at,
        };
      }
      fileMap[row.file_id].cellCount += parseInt(row.cell_count, 10);
      fileMap[row.file_id].rowCount += parseInt(row.row_count, 10) || 0;
    }

    return Object.values(fileMap);
  }

  /**
   * 获取指定文件的原始行数据（用于预览）
   * 从 metadata.full_row 按 row_index 去重重建行列表
   * @param {string} fileId
   * @param {number} limit  最多返回多少行，默认 200
   * @returns {Array<{ rowIndex, fullRow, sheetName }>}
   */
  async getFileRows(fileId, limit = 200) {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT DISTINCT ON ((metadata->>'row_index')::int, metadata->>'sheet_name')
         (metadata->>'row_index')::int AS row_index,
         metadata->>'full_row'         AS full_row,
         metadata->>'sheet_name'       AS sheet_name
       FROM file_vectors
       WHERE file_id = $1
         AND metadata->>'source' = 'excel_cell'
       ORDER BY (metadata->>'row_index')::int, metadata->>'sheet_name'
       LIMIT $2`,
      [fileId, limit],
    );
    return result.rows.map((r) => ({
      rowIndex: r.row_index,
      fullRow: r.full_row,
      sheetName: r.sheet_name,
    }));
  }

  /**
   * 语义检索 Excel 单元格，返回命中行
   * @param {string}   entityId
   * @param {string}   query
   * @param {number}   topK
   * @param {number}   minScore
   * @returns {Array<{ score, cellValue, columnName, fullRow, filename, rowIndex }>}
   */
  async search({ entityId, query, topK = 10, minScore = 0.5 }) {
    await this.initialize();

    const formatRow = (r, score) => ({
      score,
      cellValue: r.content,
      columnName: r.metadata?.column_name || '',
      fullRow: r.metadata?.full_row || r.content,
      filename: r.metadata?.filename || '',
      rowIndex: r.metadata?.row_index ?? -1,
      sheetName: r.metadata?.sheet_name || '',
      isPrimaryColumn: r.metadata?.is_primary_column === true || r.metadata?.is_primary_column === 'true',
    });

    // ── 第一步：文本精确匹配（优先处理编码/ID类精确查询）──────────────────────
    // 用 ILIKE 做包含匹配，主列命中 score=1.0，非主列 score=0.99，排在向量结果前面。
    const textResult = await this.pool.query(
      `SELECT content, metadata
       FROM file_vectors
       WHERE entity_id = $1
         AND metadata->>'source' = 'excel_cell'
         AND content ILIKE $2
       LIMIT $3`,
      [entityId, `%${query}%`, topK],
    );

    // 主列命中排前，非主列排后
    const textRows = textResult.rows
      .map((r) => {
        const isPrimary = r.metadata?.is_primary_column === true || r.metadata?.is_primary_column === 'true';
        return formatRow(r, isPrimary ? 1.0 : 0.99);
      })
      .sort((a, b) => b.score - a.score);

    // ── 第二步：向量语义检索（用于自然语言描述型查询）────────────────────────
    const queryEmbedding = await this.embeddingService.embedText(query);
    let vectorRows = [];
    if (queryEmbedding) {
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      const vectorResult = await this.pool.query(
        `SELECT
           content,
           metadata,
           1 - (embedding <=> $1::vector) AS score
         FROM file_vectors
         WHERE entity_id = $2
           AND metadata->>'source' = 'excel_cell'
           AND embedding IS NOT NULL
           AND 1 - (embedding <=> $1::vector) >= $3
         ORDER BY embedding <=> $1::vector
         LIMIT $4`,
        [embeddingStr, entityId, minScore, topK],
      );
      vectorRows = vectorResult.rows.map((r) => formatRow(r, parseFloat(r.score)));
    }

    // ── 第三步：按行去重，每行只保留最高分的那条命中 ──────────────────────────
    // 同一行可能有多个单元格命中（如同行的 kpi_code、kpi_name 都包含关键词），
    // 但只需要返回一行内容，取主列优先、分数最高的那条代表。
    const rowMap = new Map(); // key: "filename::sheetName::rowIndex"
    for (const r of [...textRows, ...vectorRows]) {
      const key = `${r.filename}::${r.sheetName}::${r.rowIndex}`;
      const existing = rowMap.get(key);
      if (!existing) {
        rowMap.set(key, r);
      } else {
        // 主列优先；同为主列或同为非主列时取高分
        const curBetter =
          (r.isPrimaryColumn && !existing.isPrimaryColumn) ||
          (r.isPrimaryColumn === existing.isPrimaryColumn && r.score > existing.score);
        if (curBetter) rowMap.set(key, r);
      }
    }

    return [...rowMap.values()]
      .sort((a, b) => (b.isPrimaryColumn ? 1 : 0) - (a.isPrimaryColumn ? 1 : 0) || b.score - a.score)
      .slice(0, topK);
  }
}

module.exports = ExcelCellVectorizationService;
