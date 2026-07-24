#!/usr/bin/env node
/**
 * 在 Mongo 中创建/更新「知识库抽取 Mock 数据源」
 *
 * 约定识别：host = knowledge-extract.mock（或 database = knowledge_extract_mock）
 * 选中该数据源后：schema/表列表与抽取走 fixture，向量化/测试检索走真实 file_vectors。
 *
 * 用法（仓库根目录，需 MONGO_URI + CREDS_KEY，与 api 一致）：
 *   node scripts/knowledge-extract-mock/ensure-mock-datasource.js
 *   node scripts/knowledge-extract-mock/ensure-mock-datasource.js --userId=<ADMIN_USER_OBJECT_ID>
 *   node scripts/knowledge-extract-mock/ensure-mock-datasource.js --email=admin@example.com
 */

const path = require('path');
const fs = require('fs');

function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../api/.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
  }
}

function parseArgs(argv) {
  const out = { userId: '', email: '' };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--userId=')) out.userId = a.slice('--userId='.length);
    else if (a.startsWith('--email=')) out.email = a.slice('--email='.length);
  }
  return out;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  if (!process.env.MONGO_URI) {
    console.error('缺少 MONGO_URI');
    process.exit(1);
  }
  if (!process.env.CREDS_KEY) {
    console.error('缺少 CREDS_KEY（与 api 加密密码一致）');
    process.exit(1);
  }

  const apiRoot = path.resolve(__dirname, '../../api');
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('~/')) {
      return orig.call(this, path.join(apiRoot, request.slice(2)), parent, isMain, options);
    }
    return orig.call(this, request, parent, isMain, options);
  };

  const mongoose = require('mongoose');
  const { encryptV2 } = require('@because/api');
  const {
    MOCK_DS_HOST,
    MOCK_DS_DATABASE,
    MOCK_DS_NAME,
  } = require(path.join(apiRoot, 'server/services/Knowledge/TableExtractService'));

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  let createdBy = args.userId || null;
  if (!createdBy && args.email) {
    const user = await db.collection('users').findOne({ email: args.email });
    if (!user) {
      console.error(`未找到 email=${args.email} 的用户`);
      process.exit(1);
    }
    createdBy = String(user._id);
  }
  if (!createdBy) {
    const admin =
      (await db.collection('users').findOne({ role: 'ADMIN' })) ||
      (await db.collection('users').findOne({}));
    if (!admin) {
      console.error('库中无用户，请先登录创建管理员，或传 --userId= / --email=');
      process.exit(1);
    }
    createdBy = String(admin._id);
    console.log(`使用用户 createdBy=${createdBy} email=${admin.email || '(无)'}`);
  }

  const encryptedPassword = await encryptV2('mock-not-used');
  const filter = {
    $or: [{ host: MOCK_DS_HOST }, { database: MOCK_DS_DATABASE }],
  };
  const existing = await db.collection('datasources').findOne(filter);

  const doc = {
    name: MOCK_DS_NAME,
    type: 'gaussdb',
    host: MOCK_DS_HOST,
    port: 8000,
    database: MOCK_DS_DATABASE,
    username: 'mock',
    password: encryptedPassword,
    connectionPool: {
      min: 0,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
    ssl: {
      enabled: false,
      rejectUnauthorized: true,
      ca: null,
      cert: null,
      key: null,
    },
    status: 'active',
    isPublic: true,
    agentIds: [],
    lastTestedAt: new Date(),
    lastTestResult: 'success',
    lastTestError: null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.collection('datasources').updateOne(
      { _id: existing._id },
      { $set: doc },
    );
    console.log(
      JSON.stringify(
        {
          action: 'updated',
          _id: String(existing._id),
          name: MOCK_DS_NAME,
          host: MOCK_DS_HOST,
          database: MOCK_DS_DATABASE,
        },
        null,
        2,
      ),
    );
  } else {
    const inserted = await db.collection('datasources').insertOne({
      ...doc,
      createdBy: new mongoose.Types.ObjectId(createdBy),
      createdAt: new Date(),
    });
    console.log(
      JSON.stringify(
        {
          action: 'created',
          _id: String(inserted.insertedId),
          name: MOCK_DS_NAME,
          host: MOCK_DS_HOST,
          database: MOCK_DS_DATABASE,
        },
        null,
        2,
      ),
    );
  }

  console.log('\n下一步：知识库管理 → 选择「【Mock】知识库抽取验收」→ 指标定义/机构信息 → 从库抽取 → 向量化 → 测试检索');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
