/**
 * TableExtractService — 从数据源表抽取指标定义 / 机构信息
 * - 最新 data_dt 快照
 * - 按 index_number / brchno 去重
 * - Mock 数据源（host=knowledge-extract.mock）走 fixture，不连 JDBC
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('@because/data-schemas');
const { buildOrgMasterFromBrchRows, ORG_MASTER_HEADERS, ORG_SOURCE_OPTIONAL_COLS, ORG_SOURCE_REQUIRED_SELECT } = require('./OrgMasterBuilder');

const KPI_FILENAME = '指标定义信息';
const ORG_FILENAME = '机构信息';
const PREVIEW_ROW_LIMIT = 200;

/** 约定：用该 host 标识「知识库抽取 Mock 数据源」，不连真实库 */
const MOCK_DS_HOST = 'knowledge-extract.mock';
const MOCK_DS_DATABASE = 'knowledge_extract_mock';
const MOCK_DS_NAME = '【Mock】知识库抽取验收';

const KPI_REQUIRED = ['index_number'];
const ORG_REQUIRED = ['data_dt', 'brchno', 'brchna', 'brchup', 'brchlv'];

function stableFileId(kind, entityId) {
  return kind === 'org' ? `org_info:${entityId}` : `kpi_def:${entityId}`;
}

function toPreviewPayload(payload, limit = PREVIEW_ROW_LIMIT) {
  const rows = payload.rows || [];
  return {
    ...payload,
    rows: rows.slice(0, limit),
    previewTruncated: rows.length > limit,
    totalRowCount: rows.length,
  };
}

/**
 * 是否为知识库抽取专用 Mock 数据源（按 host/database 约定识别）
 */
function isKnowledgeExtractMockDataSource(dataSource) {
  if (!dataSource) return false;
  const host = String(dataSource.host || '')
    .trim()
    .toLowerCase();
  const database = String(dataSource.database || '')
    .trim()
    .toLowerCase();
  return host === MOCK_DS_HOST || database === MOCK_DS_DATABASE;
}

function getMockSchemaCatalog() {
  return {
    success: true,
    database: MOCK_DS_DATABASE,
    schemas: [
      { schemaName: 'kpi', tableCount: 1 },
      { schemaName: 'cmdata', tableCount: 1 },
    ],
    mock: true,
  };
}

function getMockTablesForSchema(schemaName) {
  const schema = String(schemaName || '').toLowerCase();
  if (schema === 'kpi') {
    return {
      success: true,
      database: MOCK_DS_DATABASE,
      schemaName: 'kpi',
      tables: ['kpi_result_ctcx'],
      mock: true,
    };
  }
  if (schema === 'cmdata') {
    return {
      success: true,
      database: MOCK_DS_DATABASE,
      schemaName: 'cmdata',
      tables: ['c_par_brch_level'],
      mock: true,
    };
  }
  return {
    success: true,
    database: MOCK_DS_DATABASE,
    schemaName: schemaName || '',
    tables: [],
    mock: true,
  };
}

/** 英文字段 → 中文展示列（有则映射，无则保留原名） */
const KPI_COLUMN_MAP = {
  index_number: '指标编号',
  standard_name: '标准名称',
  index_category: '指标类别',
  kpi_category: '指标类别',
  caliber: '口径分类',
  index_attr: '指标属性',
  business_meaning: '业务含义',
  kpi_desc: '业务含义',
  calculation_method: '计算口径',
  kpi_rule: '计算口径',
  unit: '基本计量单位',
  frequency: '基本频度',
  kpi_freq: '基本频度',
  common_dims: '常用维度',
  index_number_rel: '关联指标',
  tags: '标签分类',
  kpi_remark: '标签分类',
};

/** @type {Map<string, object>} entityId:kind → last extract payload */
const extractCache = new Map();

function cacheKey(entityId, kind) {
  return `${entityId}:${kind}`;
}

function setExtractCache(entityId, kind, payload) {
  extractCache.set(cacheKey(entityId, kind), {
    ...payload,
    cachedAt: Date.now(),
  });
}

function getExtractCache(entityId, kind) {
  return extractCache.get(cacheKey(entityId, kind)) || null;
}

function clearExtractCache(entityId, kind) {
  if (kind) extractCache.delete(cacheKey(entityId, kind));
  else {
    for (const k of [...extractCache.keys()]) {
      if (k.startsWith(`${entityId}:`)) extractCache.delete(k);
    }
  }
}

function loadFixture(name) {
  const p = path.join(__dirname, '__fixtures__', name);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @param {object} options
 * @param {object} [dataSource]
 */
function shouldUseMock(options = {}, dataSource = null) {
  if (options.source === 'mock') return true;
  if (process.env.USE_KNOWLEDGE_EXTRACT_MOCK === 'true') return true;
  if (isKnowledgeExtractMockDataSource(dataSource)) return true;
  return false;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qualifiedTable(schema, table) {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function rowGet(row, ...keys) {
  if (!row) return undefined;
  const lowerMap = {};
  for (const [k, v] of Object.entries(row)) {
    lowerMap[String(k).toLowerCase()] = v;
  }
  for (const key of keys) {
    if (row[key] != null) return row[key];
    const hit = lowerMap[String(key).toLowerCase()];
    if (hit != null) return hit;
  }
  return undefined;
}

function normalizeColNames(cols) {
  return (cols || []).map((c) => String(c.column_name || c.name || c).toLowerCase());
}

async function getJdbcQuery() {
  // 相对项目根 /app/Because-2.0；本文件在 Knowledge/ 下，__dirname 上溯三级会落到 /app/api/Because-2.0
  return require(path.join(require('~/config/paths').root, 'Because-2.0/utils/gaussdbJdbcBridge'))
    .gaussdbJdbcQuery;
}

function dsCfg(dataSource) {
  return {
    _id: dataSource._id || dataSource.id,
    host: dataSource.host,
    port: dataSource.port,
    database: dataSource.database,
    username: dataSource.username,
    ssl: dataSource.ssl,
  };
}

async function listColumns(dataSource, password, schema, table) {
  const type = String(dataSource.type || '').toLowerCase();
  if (type === 'gaussdb' || type === 'postgresql' || type === 'postgres') {
    const gaussdbJdbcQuery = await getJdbcQuery();
    const rows = await gaussdbJdbcQuery(
      `SELECT a.attname AS column_name
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
       JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = ? AND c.relname = ? AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [schema, table],
      dsCfg(dataSource),
      password,
    );
    return rows.map((r) => ({ column_name: r.column_name || r.COLUMN_NAME }));
  }
  throw Object.assign(new Error(`暂不支持的数据源类型: ${dataSource.type}`), { statusCode: 400 });
}

async function runQuery(dataSource, password, sql, params = []) {
  const gaussdbJdbcQuery = await getJdbcQuery();
  return gaussdbJdbcQuery(sql, params, dsCfg(dataSource), password);
}

function preferSortTables(tables, prefer) {
  const list = [...(tables || [])];
  const preferNames =
    prefer === 'kpi'
      ? ['kpi_result_ctcx']
      : prefer === 'org'
        ? ['c_par_brch_level']
        : ['kpi_result_ctcx', 'c_par_brch_level'];
  list.sort((a, b) => {
    const an = String(a.tableName || a.table_name || a).toLowerCase();
    const bn = String(b.tableName || b.table_name || b).toLowerCase();
    const ai = preferNames.findIndex((p) => an === p);
    const bi = preferNames.findIndex((p) => bn === p);
    if (ai === -1 && bi === -1) return an.localeCompare(bn);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return list;
}

function mapCaliber(row) {
  const parts = [];
  if (String(rowGet(row, 'cal01', 'kpi_ispbc') || '') === '1') parts.push('人行');
  if (String(rowGet(row, 'cal02', 'kpi_iscbcr') || '') === '1') parts.push('银监');
  if (String(rowGet(row, 'cal03', 'kpi_isrccu') || '') === '1') parts.push('省联社');
  return parts.join('/');
}

function mapKpiRow(raw) {
  const out = {};
  const used = new Set();

  for (const [en, zh] of Object.entries(KPI_COLUMN_MAP)) {
    const v = rowGet(raw, en);
    if (v != null && String(v).trim() !== '') {
      out[zh] = String(v).trim();
      used.add(en.toLowerCase());
    }
  }

  if (!out['口径分类']) {
    const cal = mapCaliber(raw);
    if (cal) out['口径分类'] = cal;
  }

  // 指标编号必填
  const code = rowGet(raw, 'index_number', 'kpi_code');
  if (code != null) out['指标编号'] = String(code).trim();

  const name = rowGet(raw, 'standard_name', 'kpi_name');
  if (name != null && !out['标准名称']) out['标准名称'] = String(name).trim();

  // 透传未映射列（跳过纯事实列）
  const skip = new Set([
    'data_dt',
    'org_code',
    'brchno',
    'index_value',
    'curr_code',
    'cal01',
    'cal02',
    'cal03',
    ...used,
  ]);
  for (const [k, v] of Object.entries(raw || {})) {
    const lk = String(k).toLowerCase();
    if (skip.has(lk)) continue;
    if (KPI_COLUMN_MAP[lk]) continue;
    if (v == null || String(v).trim() === '') continue;
    if (out[k] == null) out[k] = String(v).trim();
  }

  return out;
}

function preferredKpiHeaders(rows) {
  const preferred = [
    '指标编号',
    '标准名称',
    '指标类别',
    '口径分类',
    '指标属性',
    '业务含义',
    '计算口径',
    '基本计量单位',
    '基本频度',
    '常用维度',
    '关联指标',
    '标签分类',
  ];
  const seen = new Set();
  const headers = [];
  for (const h of preferred) {
    if (rows.some((r) => r[h] != null && r[h] !== '')) {
      headers.push(h);
      seen.add(h);
    }
  }
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        headers.push(k);
        seen.add(k);
      }
    }
  }
  if (!headers.includes('指标编号')) headers.unshift('指标编号');
  return headers;
}

/** 只拉定义相关列，避免 SELECT * 把结果事实表打爆 JDBC */
function pickKpiSelectColumns(colNames, codeCol) {
  const want = new Set([
    ...Object.keys(KPI_COLUMN_MAP),
    'index_number',
    'kpi_code',
    'standard_name',
    'kpi_name',
    'cal01',
    'cal02',
    'cal03',
    'kpi_ispbc',
    'kpi_iscbcr',
    'kpi_isrccu',
  ]);
  const selected = [];
  const seen = new Set();
  for (const c of colNames) {
    if (!want.has(c) || seen.has(c)) continue;
    selected.push(c);
    seen.add(c);
  }
  if (!seen.has(codeCol) && colNames.includes(codeCol)) {
    selected.unshift(codeCol);
  }
  return selected.length ? selected : [codeCol];
}

function selectListSql(columns) {
  return columns.map((c) => quoteIdent(c)).join(', ');
}

/**
 * 抽取指标定义
 */
async function extractKpiDefinition({ dataSource, password, schema, table, entityId, options = {} }) {
  if (shouldUseMock(options, dataSource)) {
    const fixture = loadFixture('mock-kpi-definition.json');
    const payload = {
      kind: 'kpi',
      filename: KPI_FILENAME,
      schema: schema || 'kpi',
      table: table || 'kpi_result_ctcx',
      dataDt: fixture.dataDt,
      headers: fixture.headers,
      rows: fixture.rows,
      rowCount: fixture.rows.length,
      mock: true,
    };
    if (entityId) setExtractCache(entityId, 'kpi', payload);
    return payload;
  }

  if (!schema || !table) {
    throw Object.assign(new Error('schema 与 table 必填'), { statusCode: 400 });
  }

  const cols = await listColumns(dataSource, password, schema, table);
  const colNames = normalizeColNames(cols);
  if (!colNames.includes('index_number') && !colNames.includes('kpi_code')) {
    throw Object.assign(
      new Error(`表 ${schema}.${table} 缺少 index_number（或 kpi_code）列`),
      { statusCode: 400 },
    );
  }
  const hasDataDt = colNames.includes('data_dt');
  const codeCol = colNames.includes('index_number') ? 'index_number' : 'kpi_code';
  const qt = qualifiedTable(schema, table);
  const selectCols = pickKpiSelectColumns(colNames, codeCol);
  const selectSql = selectListSql(selectCols);
  // DISTINCT ON 的 ORDER BY 左侧必须是去重键；有 data_dt 时按各指标自身最新日期取行
  const orderExtra =
    selectCols.find((c) => c !== codeCol) || codeCol;

  let dataDt = null;
  let rowsRaw = [];

  if (hasDataDt) {
    // 元数据：表内最大日期（展示用）；行选择见下方「按键各自最新」
    const maxRows = await runQuery(
      dataSource,
      password,
      `SELECT MAX(${quoteIdent('data_dt')}) AS max_dt FROM ${qt}`,
    );
    dataDt = maxRows?.[0]?.max_dt != null ? String(maxRows[0].max_dt) : null;
    // 禁止 SELECT *；按 index_number/kpi_code 各自取 data_dt 最新一行（旧日期独有指标也会抽到）
    rowsRaw = await runQuery(
      dataSource,
      password,
      `SELECT DISTINCT ON (${quoteIdent(codeCol)}) ${selectSql}
       FROM ${qt}
       ORDER BY ${quoteIdent(codeCol)}, ${quoteIdent('data_dt')} DESC, ${quoteIdent(orderExtra)}`,
    );
  } else {
    rowsRaw = await runQuery(
      dataSource,
      password,
      `SELECT DISTINCT ON (${quoteIdent(codeCol)}) ${selectSql}
       FROM ${qt}
       ORDER BY ${quoteIdent(codeCol)}, ${quoteIdent(orderExtra)}`,
    );
  }

  const dedup = new Map();
  for (const raw of rowsRaw || []) {
    const code = String(rowGet(raw, codeCol, 'index_number', 'kpi_code') || '').trim();
    if (!code) continue;
    dedup.set(code, mapKpiRow(raw));
  }
  const rows = [...dedup.values()];
  const headers = preferredKpiHeaders(rows);
  const normalized = rows.map((r) => {
    const o = {};
    for (const h of headers) o[h] = r[h] ?? '';
    return o;
  });

  const payload = {
    kind: 'kpi',
    filename: KPI_FILENAME,
    schema,
    table,
    dataDt,
    headers,
    rows: normalized,
    rowCount: normalized.length,
  };
  if (entityId) setExtractCache(entityId, 'kpi', payload);
  logger.info(
    `[TableExtract] KPI extracted entity=${entityId} table=${schema}.${table} dataDt=${dataDt} rows=${payload.rowCount} cols=${selectCols.length}`,
  );
  return payload;
}

/**
 * 抽取机构信息（完整 org_master 派生）
 */
async function extractOrgInfo({ dataSource, password, schema, table, entityId, options = {} }) {
  if (shouldUseMock(options, dataSource)) {
    const fixture = loadFixture('mock-org-info.json');
    // 优先用 rawBrchRows 现场派生，保证与真实链路一致（完整 org_master，非源表四列）
    const built =
      Array.isArray(fixture.rawBrchRows) && fixture.rawBrchRows.length
        ? buildOrgMasterFromBrchRows(fixture.rawBrchRows)
        : {
            headers: fixture.headers || [...ORG_MASTER_HEADERS],
            rows: fixture.rows || [],
            rowCount: (fixture.rows || []).length,
          };
    const payload = {
      kind: 'org',
      filename: ORG_FILENAME,
      schema: schema || 'cmdata',
      table: table || 'c_par_brch_level',
      dataDt: fixture.dataDt,
      headers: built.headers,
      rows: built.rows,
      rowCount: built.rowCount,
      mock: true,
    };
    if (entityId) setExtractCache(entityId, 'org', payload);
    return payload;
  }

  if (!schema || !table) {
    throw Object.assign(new Error('schema 与 table 必填'), { statusCode: 400 });
  }

  const cols = await listColumns(dataSource, password, schema, table);
  const colNames = normalizeColNames(cols);
  const missing = ORG_REQUIRED.filter((c) => !colNames.includes(c));
  if (missing.length) {
    throw Object.assign(
      new Error(
        `表 ${schema}.${table} 结构不符合 c_par_brch_level 规范，缺少必填列: ${missing.join(', ')}`,
      ),
      { statusCode: 400 },
    );
  }

  const qt = qualifiedTable(schema, table);
  // 元数据：表内最大日期（展示用）；行选择按 brchno 各自取最新 data_dt
  const maxRows = await runQuery(
    dataSource,
    password,
    `SELECT MAX(${quoteIdent('data_dt')}) AS max_dt FROM ${qt}`,
  );
  const dataDt = maxRows?.[0]?.max_dt != null ? String(maxRows[0].max_dt) : null;

  // 窄列拉取：必填树字段 + 表内存在的补充列（用于 parent_org_name / scope_note 等）
  // 按 brchno 各自取 data_dt 最新一行（最新日期缺席、旧日期有记录的机构也会抽到）
  const selectCols = [
    ...ORG_SOURCE_REQUIRED_SELECT,
    ...ORG_SOURCE_OPTIONAL_COLS.filter((c) => colNames.includes(c)),
  ];
  const rowsRaw = await runQuery(
    dataSource,
    password,
    `SELECT DISTINCT ON (${quoteIdent('brchno')}) ${selectListSql(selectCols)}
     FROM ${qt}
     ORDER BY ${quoteIdent('brchno')}, ${quoteIdent('data_dt')} DESC, ${quoteIdent('brchna')}`,
  );

  const dedup = new Map();
  for (const raw of rowsRaw || []) {
    const code = String(rowGet(raw, 'brchno') || '').trim();
    if (!code) continue;
    const row = {
      brchno: code,
      brchna: String(rowGet(raw, 'brchna') || '').trim(),
      brchup: String(rowGet(raw, 'brchup') || '').trim(),
      brchlv: rowGet(raw, 'brchlv'),
    };
    for (const c of ORG_SOURCE_OPTIONAL_COLS) {
      const v = rowGet(raw, c);
      if (v != null && String(v).trim() !== '') row[c] = String(v).trim();
    }
    dedup.set(code, row);
  }

  // 输出完整 org_master 结构（含 leaf_child_* / kpi_query_*），不是源表四列
  const built = buildOrgMasterFromBrchRows([...dedup.values()]);
  const payload = {
    kind: 'org',
    filename: ORG_FILENAME,
    schema,
    table,
    dataDt,
    headers: built.headers,
    rows: built.rows,
    rowCount: built.rowCount,
  };
  if (entityId) setExtractCache(entityId, 'org', payload);
  logger.info(
    `[TableExtract] Org extracted entity=${entityId} table=${schema}.${table} dataDt=${dataDt} rows=${payload.rowCount} (org_master cols=${built.headers.length})`,
  );
  return payload;
}

module.exports = {
  KPI_FILENAME,
  ORG_FILENAME,
  KPI_REQUIRED,
  ORG_REQUIRED,
  PREVIEW_ROW_LIMIT,
  MOCK_DS_HOST,
  MOCK_DS_DATABASE,
  MOCK_DS_NAME,
  preferSortTables,
  extractKpiDefinition,
  extractOrgInfo,
  getExtractCache,
  setExtractCache,
  clearExtractCache,
  shouldUseMock,
  isKnowledgeExtractMockDataSource,
  getMockSchemaCatalog,
  getMockTablesForSchema,
  stableFileId,
  toPreviewPayload,
};
