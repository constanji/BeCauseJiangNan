/**
 * Excel 知识检索列配置与评分工具
 * - 主列（primary）：高优先级，精确编码类查询优先命中
 * - 可检索列（searchable）：默认列，可被命中
 * - 排除列（excluded）：不向量化、不参与检索
 */

function normalizeColumnName(name) {
  return String(name || '').trim().toLowerCase();
}

function buildColumnSet(columns = []) {
  return new Set((columns || []).map(normalizeColumnName).filter(Boolean));
}

function parseColumnList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((c) => String(c).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,，]/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * 从 xlsx Buffer 解析各 sheet 表头（首行）
 * @param {Buffer} buffer
 * @returns {{ sheetNames: string[], sheets: Array<{ name: string, headers: string[] }> }}
 */
function parseWorkbookHeaders(buffer) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows || rows.length === 0) continue;
    const headers = rows[0].map((h) => String(h).trim()).filter(Boolean);
    if (headers.length === 0) continue;
    sheets.push({ name, headers });
  }

  return { sheetNames: workbook.SheetNames, sheets };
}

/**
 * 计算 query 作为「有序子序列」出现在 target 中时的紧凑度（0~1）。
 * 用于命中"溧阳市支行"命中查询"溧阳支行"这类中间插入了其他字符、
 * 字面上不是连续子串（ILIKE 匹配不到）、但确实是同一实体的场景。
 * @returns {number|null} null 表示不构成子序列
 */
function computeSubsequenceCompactness(query, target) {
  if (!query || !target || query.length === 0) return null;

  let qi = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      if (firstIdx === -1) firstIdx = ti;
      lastIdx = ti;
      qi++;
    }
  }
  if (qi < query.length) return null;

  const span = lastIdx - firstIdx + 1;
  return query.length / span;
}

/** 子序列匹配的最小紧凑度阈值：跨度超过 query 长度的 2 倍（紧凑度 < 0.5）时，
 * 说明字符分散得太散，不再认为是有意义的模糊匹配，避免"支"这种单字扫中一大片无关行。 */
const MIN_FUZZY_COMPACTNESS = 0.5;

const FUZZY_SCORE_TIERS = {
  primary: { base: 0.75, spread: 0.15 }, // 命中区间 [0.825, 0.90]：低于主列包含命中(0.93)，高于向量主列上限(0.6)
  nonPrimary: { base: 0.38, spread: 0.1 }, // 命中区间 [0.43, 0.48]：低于非主列包含命中(0.55)，高于向量非主列上限(0.3)
  noPrimaryConfig: { base: 0.6, spread: 0.15 }, // 未配置主列时的通用兜底档位
};

/**
 * 计算文本匹配分数。
 * 优先按字面包含（子串）匹配评分；字面不包含时，尝试有序子序列模糊匹配作为兜底档位，
 * 该档位分数始终低于同类型的字面包含命中，但高于向量语义匹配的分数上限，
 * 确保"溧阳支行"这类中间插字场景不会退化成不可靠的纯语义匹配。
 * @returns {number|null} null 表示不应计入结果
 */
function computeTextMatchScore({ query, cellValue, isPrimaryColumn, hasPrimaryConfig }) {
  const q = String(query || '').trim().toLowerCase();
  const v = String(cellValue || '').trim().toLowerCase();
  if (!q || !v) return null;

  const isExact = v === q;
  const isContains = v.includes(q);

  if (isContains) {
    if (hasPrimaryConfig) {
      if (isPrimaryColumn) {
        return isExact ? 1.0 : 0.93;
      }
      return isExact ? 0.72 : 0.55;
    }
    return isExact ? 1.0 : 0.82;
  }

  const compactness = computeSubsequenceCompactness(q, v);
  if (compactness == null || compactness < MIN_FUZZY_COMPACTNESS) return null;

  const tier = hasPrimaryConfig
    ? isPrimaryColumn
      ? FUZZY_SCORE_TIERS.primary
      : FUZZY_SCORE_TIERS.nonPrimary
    : FUZZY_SCORE_TIERS.noPrimaryConfig;

  return tier.base + compactness * tier.spread;
}

/** 向量匹配的分数上限：短编码类主列（如 org_code）的嵌入向量彼此距离很近，
 * 常出现「A0000」「A0001」「FR001」等不同编码相似度接近 1.0 的假高分，
 * 必须让向量分数的上限严格低于任意文本命中档位（非主列包含命中 0.55 都不应被压过），
 * 否则真正的精确匹配会被相似度虚高的无关行挤到后面（按行号排序）。 */
const VECTOR_SCORE_CAP_PRIMARY = 0.6;
const VECTOR_SCORE_CAP_NON_PRIMARY = 0.3;

/**
 * 向量语义分数叠加列权重
 * 仅在没有文本命中时才会被采用，因此需要压低到低于所有文本命中档位。
 */
function applyVectorColumnWeight(score, isPrimaryColumn, hasPrimaryConfig) {
  const base = Number(score) || 0;
  if (!hasPrimaryConfig) return base;
  if (isPrimaryColumn) {
    return Math.min(base, VECTOR_SCORE_CAP_PRIMARY);
  }
  return Math.min(base * 0.65, VECTOR_SCORE_CAP_NON_PRIMARY);
}

function parseMetadataFlag(value) {
  return value === true || value === 'true';
}

function formatSearchRow(row, score) {
  const metadata = row.metadata || {};
  return {
    score,
    cellValue: row.content,
    columnName: metadata.column_name || '',
    fullRow: metadata.full_row || row.content,
    filename: metadata.filename || '',
    rowIndex: metadata.row_index ?? -1,
    sheetName: metadata.sheet_name || '',
    isPrimaryColumn: parseMetadataFlag(metadata.is_primary_column),
    isExactMatch: parseMetadataFlag(metadata._exact_match),
  };
}

/**
 * 合并文本命中与向量命中，按行去重并排序
 */
function mergeSearchResults({ textRows = [], vectorRows = [], topK = 10, hasPrimaryConfig = false }) {
  const rowMap = new Map();

  const consider = (candidate) => {
    const key = `${candidate.filename}::${candidate.sheetName}::${candidate.rowIndex}`;
    const existing = rowMap.get(key);
    if (!existing) {
      rowMap.set(key, candidate);
      return;
    }

    const curBetter =
      (candidate.isPrimaryColumn && !existing.isPrimaryColumn) ||
      (candidate.isPrimaryColumn === existing.isPrimaryColumn &&
        ((candidate.isExactMatch && !existing.isExactMatch) ||
          (candidate.isExactMatch === existing.isExactMatch && candidate.score > existing.score)));
    if (curBetter) rowMap.set(key, candidate);
  };

  for (const row of textRows) consider(row);
  for (const row of vectorRows) consider(row);

  let results = [...rowMap.values()];

  if (hasPrimaryConfig) {
    const primaryHits = results.filter((r) => r.isPrimaryColumn);
    if (primaryHits.length > 0) {
      results = primaryHits;
    }
  }

  return results
    .sort(
      (a, b) =>
        (b.isPrimaryColumn ? 1 : 0) - (a.isPrimaryColumn ? 1 : 0) ||
        (b.isExactMatch ? 1 : 0) - (a.isExactMatch ? 1 : 0) ||
        b.score - a.score ||
        a.rowIndex - b.rowIndex,
    )
    .slice(0, topK);
}

/**
 * 序列化整行内容，供命中后原样返回给前端/Agent。
 * 主列/可检索/排除只影响「是否参与检索匹配」，不影响返回内容——
 * 排除列仍是已整理好的数据，命中同一行的其他列时应完整看到该列内容，
 * 所以这里始终包含所有列，不做任何过滤。
 */
function buildFullRow(headers, row) {
  return headers
    .map((h, colIdx) => {
      const value = String(row[colIdx] ?? '').trim();
      if (!value) return '';
      return `${h}: ${value}`;
    })
    .filter(Boolean)
    .join(' | ');
}

module.exports = {
  normalizeColumnName,
  buildColumnSet,
  parseColumnList,
  parseWorkbookHeaders,
  computeSubsequenceCompactness,
  computeTextMatchScore,
  applyVectorColumnWeight,
  parseMetadataFlag,
  formatSearchRow,
  mergeSearchResults,
  buildFullRow,
};
