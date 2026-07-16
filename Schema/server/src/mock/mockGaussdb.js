const BUSINESS_TERMS = ['贷款', '信用卡', '逾期', '客户', '机构', '额度', '还款', '风险', '账户', '交易'];

const SCHEMA_CONFIGS = [
  {
    name: 'mock_core',
    tableNames: ['c_d_cust_base', 'c_d_org_branch', 'c_d_acct_core', 'c_d_product_map', 'c_d_staff_info', 'c_d_channel_dim', 'c_d_region_map', 'c_d_settle_calendar'],
    theme: '核心客户账户',
  },
  {
    name: 'mock_card',
    tableNames: ['c_d_tpc_card_info', 'c_d_tpc_acct', 'c_d_card_bill', 'c_d_card_txn', 'c_d_card_limit', 'c_d_card_status', 'c_d_card_repay'],
    theme: '信用卡账户',
  },
  {
    name: 'mock_loan',
    tableNames: ['c_d_loan_contract', 'c_d_loan_balance', 'c_d_loan_repay_plan', 'c_d_loan_overdue', 'c_d_loan_collateral', 'c_d_loan_customer'],
    theme: '贷款业务',
  },
  {
    name: 'mock_risk',
    tableNames: ['c_d_risk_customer', 'c_d_risk_event', 'c_d_risk_rule_hit', 'c_d_overdue_warning', 'c_d_blacklist'],
    theme: '风险预警',
  },
  {
    name: 'mock_report',
    tableNames: ['rpt_daily_balance', 'rpt_loan_quality', 'rpt_card_profit', 'rpt_org_summary'],
    theme: '监管报表',
  },
];

const EXTRA_COLUMNS = [
  { name: 'data_dt', type: 'varchar', nullable: false, description: '数据日期' },
  { name: 'lp_org_num', type: 'varchar', nullable: true, description: '法人机构号' },
  { name: 'branch_org', type: 'varchar', nullable: true, description: '所属分支机构ID' },
  { name: 'core_org', type: 'varchar', nullable: true, description: '核心机构号' },
  { name: 'org_name', type: 'varchar', nullable: true, description: '机构名称' },
  { name: 'cust_id', type: 'varchar', nullable: true, description: '客户ID' },
  { name: 'cust_name', type: 'varchar', nullable: true, description: '客户名称' },
  { name: 'acct_no', type: 'varchar', nullable: true, description: '账号' },
  { name: 'fin_acct', type: 'varchar', nullable: true, description: '财务账号' },
  { name: 'card_no', type: 'varchar', nullable: true, description: '卡号' },
  { name: 'loan_no', type: 'varchar', nullable: true, description: '贷款合同号' },
  { name: 'product_name', type: 'varchar', nullable: true, description: '产品名称' },
  { name: 'acct_type_name', type: 'varchar', nullable: true, description: '账户类型名称' },
  { name: 'loan_amt', type: 'numeric', nullable: true, description: '贷款金额' },
  { name: 'crdt_limit', type: 'numeric', nullable: true, description: '信用额度' },
  { name: 'curr_bal', type: 'numeric', nullable: true, description: '当前余额' },
  { name: 'overdue_amt', type: 'numeric', nullable: true, description: '逾期金额' },
  { name: 'risk_level', type: 'varchar', nullable: true, description: '风险等级' },
  { name: 'status_cd', type: 'varchar', nullable: true, description: '状态代码' },
  { name: 'remark', type: 'text', nullable: true, description: '业务备注' },
];

const ORGS = ['西郊支行', '郑陆支行', '金江苑支行', '靖江支行营业部', '新闸支行', '武进支行', '城南支行'];
const PRODUCTS = ['个人住房贷款', '经营周转贷款', '京东标准卡账户', '融通分期账户', '普惠小微贷款', '银联数字卡'];
const STATUS = ['正常', '关注', '逾期', '冻结', '销户', '催收中'];
const RISK = ['低风险', '中风险', '高风险', '极高风险'];

function pad(num, size) {
  return String(num).padStart(size, '0');
}

function pick(list, index) {
  return list[index % list.length];
}

function columnsForTable(schemaName, tableName, tableIndex) {
  const base = [
    { name: 'id', type: 'integer', nullable: false, description: '主键ID' },
    { name: 'data_dt', type: 'varchar', nullable: false, description: '数据日期' },
    { name: 'org_name', type: 'varchar', nullable: true, description: '机构名称' },
    { name: 'cust_id', type: 'varchar', nullable: true, description: '客户ID' },
  ];
  const lower = `${schemaName}.${tableName}`.toLowerCase();
  let preferred;
  if (lower.includes('loan')) {
    preferred = ['loan_no', 'product_name', 'loan_amt', 'curr_bal', 'overdue_amt', 'risk_level', 'status_cd', 'remark'];
  } else if (lower.includes('card') || lower.includes('tpc')) {
    preferred = ['card_no', 'acct_no', 'product_name', 'crdt_limit', 'curr_bal', 'overdue_amt', 'status_cd', 'remark'];
  } else if (lower.includes('risk') || lower.includes('overdue') || lower.includes('blacklist')) {
    preferred = ['acct_no', 'loan_no', 'overdue_amt', 'risk_level', 'status_cd', 'remark'];
  } else if (lower.includes('org') || lower.includes('branch')) {
    preferred = ['lp_org_num', 'branch_org', 'core_org', 'acct_type_name', 'status_cd', 'remark'];
  } else {
    preferred = ['acct_no', 'fin_acct', 'product_name', 'acct_type_name', 'curr_bal', 'status_cd', 'remark'];
  }
  const wanted = new Set([...base.map((c) => c.name), ...preferred]);
  for (let i = 0; wanted.size < 10 + (tableIndex % 4); i += 1) {
    wanted.add(EXTRA_COLUMNS[i % EXTRA_COLUMNS.length].name);
  }
  const byName = new Map([...base, ...EXTRA_COLUMNS].map((c) => [c.name, c]));
  return [...wanted].map((name) => byName.get(name)).filter(Boolean);
}

function valueForColumn(columnName, rowIndex, schemaName, tableName, theme) {
  const seed = rowIndex + tableName.length + schemaName.length;
  if (columnName === 'id') return rowIndex + 1;
  if (columnName === 'data_dt') return `202607${pad((rowIndex % 28) + 1, 2)}`;
  if (columnName === 'lp_org_num') return `001${pad((seed % 80) + 1, 3)}`;
  if (columnName === 'branch_org') return `00${pad((seed % 900) + 100, 4)}`;
  if (columnName === 'core_org') return `01${pad((seed % 90) + 10, 3)}`;
  if (columnName === 'org_name') return pick(ORGS, seed);
  if (columnName === 'cust_id') return `80${pad(8100000 + seed * 17, 8)}`;
  if (columnName === 'cust_name') return `${pick(['张', '王', '李', '赵', '陈', '刘'], seed)}${pick(['明', '华', '芳', '强', '敏', '磊'], seed + 2)}`;
  if (columnName === 'acct_no') return `00000000000009${pad(seed * 37, 6)}`;
  if (columnName === 'fin_acct') return `00000000000008${pad(seed * 41, 6)}`;
  if (columnName === 'card_no') return `6222${pad(100000000000 + seed * 97, 12)}`;
  if (columnName === 'loan_no') return `LN2026${pad(seed * 29, 8)}`;
  if (columnName === 'product_name') return pick(PRODUCTS, seed);
  if (columnName === 'acct_type_name') return pick(['人民币账户', '京东标准卡账户', '融通分期账户', '基础结算账户'], seed);
  if (columnName === 'loan_amt') return 50000 + seed * 1200;
  if (columnName === 'crdt_limit') return 10000 + seed * 300;
  if (columnName === 'curr_bal') return 1000 + seed * 88;
  if (columnName === 'overdue_amt') return seed % 5 === 0 ? 500 + seed * 40 : 0;
  if (columnName === 'risk_level') return pick(RISK, seed);
  if (columnName === 'status_cd') return pick(STATUS, seed);
  if (columnName === 'remark') {
    const term = pick(BUSINESS_TERMS, seed);
    return `${theme}模拟数据，包含${term}场景，用于 LightSchema 找表与深挖测试`;
  }
  return `${columnName}_${seed}`;
}

function createTable(schemaName, tableName, tableIndex, theme) {
  const columns = columnsForTable(schemaName, tableName, tableIndex);
  const rowCount = 24 + ((schemaName.length + tableName.length + tableIndex) % 17);
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = {};
    for (const col of columns) {
      row[col.name] = valueForColumn(col.name, rowIndex, schemaName, tableName, theme);
    }
    return row;
  });
  return {
    schemaName,
    tableName,
    tableDescription: `${theme} - ${tableName} 模拟表`,
    columns,
    primaryKeys: ['id'],
    rows,
  };
}

const DATASET = (() => {
  const schemas = new Map();
  for (const schema of SCHEMA_CONFIGS) {
    const tables = new Map();
    schema.tableNames.forEach((tableName, index) => {
      tables.set(tableName, createTable(schema.name, tableName, index, schema.theme));
    });
    schemas.set(schema.name, tables);
  }
  return schemas;
})();

function getTable(schemaName, tableName) {
  const table = DATASET.get(schemaName)?.get(tableName);
  if (!table) {
    const err = new Error(`mock 数据源中不存在表 ${schemaName}.${tableName}`);
    err.code = 'MOCK_TABLE_NOT_FOUND';
    throw err;
  }
  return table;
}

function includesText(value, query) {
  return String(value ?? '').toLowerCase().includes(String(query || '').toLowerCase());
}

function sampleValues(table, column, sampleLimit, sampleScope) {
  if (sampleScope !== 'all_columns' && !isTextColumn(column.type)) return [];
  const seen = new Set();
  for (const row of table.rows) {
    const value = row[column.name];
    if (value == null || value === '') continue;
    seen.add(String(value));
    if (seen.size >= sampleLimit) break;
  }
  return [...seen];
}

function isTextColumn(type) {
  const t = String(type || '').toLowerCase();
  return t.includes('char') || t.includes('text') || t === 'varchar';
}

function listSchemas() {
  return [...DATASET.entries()].map(([schemaName, tables]) => ({
    schemaName,
    tableCount: tables.size,
  }));
}

function listTables(schemaName) {
  const tables = DATASET.get(schemaName);
  if (!tables) return [];
  return [...tables.keys()].sort();
}

function getTableSchema(schemaName, tableName, sampleLimit = 5, sampleScope = 'text_only') {
  const table = getTable(schemaName, tableName);
  const columns = table.columns.map((column) => ({
    ...column,
    sampleValues: sampleValues(table, column, sampleLimit, sampleScope),
  }));
  return {
    tableName,
    tableDescription: table.tableDescription,
    columns,
    primaryKeys: table.primaryKeys,
  };
}

function tableExists(schemaName, tableName) {
  return Boolean(DATASET.get(schemaName)?.has(tableName));
}

function isTableEmpty(schemaName, tableName) {
  return getTable(schemaName, tableName).rows.length === 0;
}

function applyFilters(rows, filters) {
  return rows.filter((row) => (
    filters.every((filter) => includesText(row[filter.column], filter.value))
  ));
}

function queryTableRows(options = {}) {
  const table = getTable(options.schemaName, options.tableName);
  const columns = options.columns || table.columns.map((col) => col.name);
  const filters = Array.isArray(options.filters) ? options.filters : [];
  const limit = Math.max(1, Number(options.limit || 50));
  let rows = applyFilters(table.rows, filters);
  if (options.dedupeBy) {
    const seen = new Set();
    rows = rows.filter((row) => {
      const key = String(row[options.dedupeBy] ?? '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  rows = rows.slice(0, limit).map((row) => {
    const out = {};
    for (const col of columns) out[col] = row[col];
    return out;
  });
  return {
    columns,
    rows,
    truncated: rows.length >= limit,
    limit,
    filtered: filters.length > 0,
    deduped: Boolean(options.dedupeBy),
    dedupeBy: options.dedupeBy || undefined,
  };
}

function queryDistinctColumnValues(options = {}) {
  const table = getTable(options.schemaName, options.tableName);
  const limit = Math.max(1, Number(options.limit || 200));
  const values = [];
  const seen = new Set();
  for (const row of table.rows) {
    const value = String(row[options.column] ?? '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length >= limit) break;
  }
  return { column: options.column, values, truncated: values.length >= limit, limit };
}

function deepSearchTableValues(options = {}) {
  const table = getTable(options.schemaName, options.tableName);
  const query = String(options.q || '');
  const textColumns = Array.isArray(options.textColumns) ? options.textColumns : [];
  const limitPerColumn = Math.max(1, Number(options.limitPerColumn || 5));
  const hits = [];
  for (const columnName of textColumns) {
    const values = [];
    const seen = new Set();
    for (const row of table.rows) {
      const value = row[columnName];
      if (!includesText(value, query)) continue;
      const text = String(value);
      if (seen.has(text)) continue;
      seen.add(text);
      values.push(text);
      if (values.length >= limitPerColumn) break;
    }
    if (values.length > 0) hits.push({ columnName, values });
  }
  return hits;
}

function searchSchemaTables(schemaName, query) {
  const tables = DATASET.get(schemaName);
  if (!tables) return [];
  const rows = [];
  for (const table of tables.values()) {
    for (const col of table.columns) {
      if (includesText(table.tableName, query) || includesText(col.name, query) || includesText(col.description, query)) {
        rows.push({
          schemaName,
          tableName: table.tableName,
          columnName: col.name,
          description: col.description || '',
        });
      }
    }
  }
  return rows;
}

function countTableColumns(schemaName, tableNames) {
  const map = new Map();
  for (const tableName of tableNames || []) {
    if (tableExists(schemaName, tableName)) {
      map.set(tableName, getTable(schemaName, tableName).columns.length);
    }
  }
  return map;
}

module.exports = {
  listSchemas,
  listTables,
  getTableSchema,
  tableExists,
  isTableEmpty,
  queryTableRows,
  queryDistinctColumnValues,
  deepSearchTableValues,
  searchSchemaTables,
  countTableColumns,
};
