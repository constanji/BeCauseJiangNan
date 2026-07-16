const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initDatabase } = require('../src/db/sqlite');
const {
  formatTagDisplayName,
  mapTagRow,
  fetchTagsForSchemaIds,
  findDuplicateTag,
  validateParentTag,
} = require('../src/lib/tagHelpers');

describe('tag hierarchy', () => {
  /** @type {import('better-sqlite3').Database} */
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    initDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  it('formatTagDisplayName 子标签显示为 父：子', () => {
    assert.equal(formatTagDisplayName('机构', '银行卡'), '银行卡：机构');
    assert.equal(formatTagDisplayName('指标', null), '指标');
  });

  it('同级名称唯一，不同父标签下可重名', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
      .run('银行卡', '#10a37f', ts, ts);
    const parentA = db.prepare('SELECT id FROM tags WHERE name = ?').get('银行卡').id;
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
      .run('指标', '#3b82f6', ts, ts);
    const parentB = db.prepare('SELECT id FROM tags WHERE name = ?').get('指标').id;

    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('机构', '#f97316', parentA, ts, ts);
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('机构', '#a855f7', parentB, ts, ts);

    assert.throws(() => {
      db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('机构', '#f97316', parentA, ts, ts);
    });
  });

  it('fetchTagsForSchemaIds 返回 displayName', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const now = ts;
    db.prepare(`
      INSERT INTO data_sources (
        id, name, host, port, database_name, username, password_enc, created_at, updated_at
      ) VALUES (1, 'DS', 'localhost', 5432, 'db', 'u', 'enc', ?, ?)
    `).run(now, now);
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
      .run('银行卡', '#10a37f', ts, ts);
    const parentId = db.prepare('SELECT id FROM tags WHERE name = ?').get('银行卡').id;
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('机构', '#f97316', parentId, ts, ts);
    const childId = db.prepare('SELECT id FROM tags WHERE name = ? AND parent_id = ?').get('机构', parentId).id;
    db.prepare(`
      INSERT INTO light_schemas (
        id, data_source_id, schema_name, table_name, content, ddl_text, created_at, updated_at
      ) VALUES (1, 1, 'fin', 'cards', '{}', 'ddl', ?, ?)
    `).run(ts, ts);
    db.prepare('INSERT INTO light_schema_tags (light_schema_id, tag_id) VALUES (1, ?)').run(childId);

    const map = fetchTagsForSchemaIds(db, [1]);
    const tags = map.get(1);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].displayName, '银行卡：机构');
    assert.equal(tags[0].parentName, '银行卡');
  });

  it('validateParentTag 拒绝在子标签下再建子标签', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
      .run('银行卡', '#10a37f', ts, ts);
    const parentId = db.prepare('SELECT id FROM tags WHERE name = ?').get('银行卡').id;
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('机构', '#f97316', parentId, ts, ts);
    const childId = db.prepare('SELECT id FROM tags WHERE parent_id = ?').get(parentId).id;

    const bad = validateParentTag(db, childId);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /不能再创建子标签/);
  });

  it('findDuplicateTag 区分根与子级', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
      .run('银行卡', '#10a37f', ts, ts);
    const parentId = db.prepare('SELECT id FROM tags WHERE name = ?').get('银行卡').id;

    assert.ok(findDuplicateTag(db, '银行卡', null));
    assert.ok(!findDuplicateTag(db, '机构', parentId));
    db.prepare('INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('机构', '#f97316', parentId, ts, ts);
    assert.ok(findDuplicateTag(db, '机构', parentId));
  });

  it('mapTagRow 包含 childCount 与 usageCount', () => {
    const row = {
      id: 1,
      name: '银行卡',
      color: '#10a37f',
      parent_id: null,
      parent_name: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      usage_count: 2,
      child_count: 3,
    };
    const tag = mapTagRow(row);
    assert.equal(tag.displayName, '银行卡');
    assert.equal(tag.usageCount, 2);
    assert.equal(tag.childCount, 3);
  });
});
