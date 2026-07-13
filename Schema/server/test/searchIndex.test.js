const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initDatabase } = require('../src/db/sqlite');
const {
  buildColumnSearchText,
  normalizeSearchLike,
  columnMatchesQuery,
  columnMatchesSampleQuery,
} = require('../src/lib/lightSchemaIndex');

function makeContent(overrides = {}) {
  return JSON.stringify({
    tableDescription: '账户表',
    columns: [
      { name: 'account_id', description: '账户编号' },
      { name: 'loan_type', description: '贷款类型', sampleValues: ['住房贷款', '经营贷'] },
    ],
    ...overrides,
  });
}

function seedLightSchema(db, {
  dataSourceId,
  schemaName,
  tableName,
  content,
}) {
  const searchText = buildColumnSearchText(content);
  db.prepare(`
    INSERT INTO light_schemas (
      data_source_id, schema_name, table_name, content, ddl_text,
      column_search_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dataSourceId,
    schemaName,
    tableName,
    content,
    `CREATE TABLE ${tableName} (id int);`,
    searchText,
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
  );
}

describe('light_schemas search index', () => {
  /** @type {import('better-sqlite3').Database} */
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    initDatabase(db);
    const now = '2026-01-01T00:00:00.000Z';
    db.prepare(`
      INSERT INTO data_sources (
        id, name, host, port, database_name, username, password_enc, created_at, updated_at
      ) VALUES (1, 'DS-A', 'localhost', 5432, 'db_a', 'u', 'enc', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO data_sources (
        id, name, host, port, database_name, username, password_enc, created_at, updated_at
      ) VALUES (2, 'DS-B', 'localhost', 5432, 'db_b', 'u', 'enc', ?, ?)
    `).run(now, now);
  });

  afterEach(() => {
    db.close();
  });

  it('stats bySchema 带 dataSourceId 分组', () => {
    seedLightSchema(db, {
      dataSourceId: 1,
      schemaName: 'fin',
      tableName: 'loans',
      content: makeContent(),
    });
    seedLightSchema(db, {
      dataSourceId: 2,
      schemaName: 'fin',
      tableName: 'accounts',
      content: makeContent({ tableDescription: '另一张表' }),
    });

    const bySchema = db.prepare(`
      SELECT data_source_id, schema_name, COUNT(*) AS count
      FROM light_schemas
      GROUP BY data_source_id, schema_name
      ORDER BY data_source_id, schema_name
    `).all().map((row) => ({
      dataSourceId: String(row.data_source_id),
      schemaName: row.schema_name,
      count: Number(row.count),
    }));

    assert.equal(bySchema.length, 2);
    assert.deepEqual(bySchema[0], { dataSourceId: '1', schemaName: 'fin', count: 1 });
    assert.deepEqual(bySchema[1], { dataSourceId: '2', schemaName: 'fin', count: 1 });
  });

  it('data-search SQL 预过滤可通过 column_search_text 命中采样值', () => {
    seedLightSchema(db, {
      dataSourceId: 1,
      schemaName: 'fin',
      tableName: 'loans',
      content: makeContent(),
    });
    seedLightSchema(db, {
      dataSourceId: 1,
      schemaName: 'fin',
      tableName: 'customers',
      content: makeContent({
        columns: [{ name: 'name', description: '客户姓名', sampleValues: ['张三'] }],
      }),
    });

    const like = normalizeSearchLike('住房');
    const rows = db.prepare(`
      SELECT ls.*
      FROM light_schemas ls
      WHERE ls.data_source_id = ? AND ls.schema_name = ?
        AND (LOWER(IFNULL(ls.column_search_text, '')) LIKE ? OR LOWER(ls.table_name) LIKE ?)
      ORDER BY ls.table_name
    `).all(1, 'fin', like, like);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].table_name, 'loans');

    const parsed = JSON.parse(rows[0].content);
    const matches = [];
    for (const col of parsed.columns) {
      if (columnMatchesSampleQuery(col, '住房') || columnMatchesQuery(col, '住房')) {
        matches.push(col.name);
      }
    }
    assert.deepEqual(matches, ['loan_type']);
  });

  it('schemaTableNames 返回当前 Schema 全部表名供深度跳过轻量命中', () => {
    seedLightSchema(db, {
      dataSourceId: 1,
      schemaName: 'kpi',
      tableName: 'alpha',
      content: makeContent(),
    });
    seedLightSchema(db, {
      dataSourceId: 1,
      schemaName: 'kpi',
      tableName: 'beta',
      content: makeContent({ tableDescription: 'B' }),
    });

    const schemaTableNames = db.prepare(`
      SELECT ls.table_name
      FROM light_schemas ls
      WHERE ls.data_source_id = ? AND ls.schema_name = ?
      ORDER BY ls.table_name
    `).all(1, 'kpi').map((row) => row.table_name);

    assert.deepEqual(schemaTableNames, ['alpha', 'beta']);

    const lightHitTables = new Set(['alpha']);
    const remaining = schemaTableNames.filter((name) => !lightHitTables.has(name));
    assert.deepEqual(remaining, ['beta']);
  });
});
