#!/usr/bin/env node
/**
 * 将 mock fixture 直接 vectorizeFromRows 写入指定 entityId（跳过选表 UI）
 *
 * 用法:
 *   node scripts/knowledge-extract-mock/seed-vectorize.js --entityId=<id> --kind=kpi|org [--userId=]
 *
 * 需在 api 工作目录上下文可 require 服务（建议从仓库根目录执行，并设置 NODE_PATH / 用 api 的模块解析）。
 */

const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const out = { kind: 'kpi', entityId: '', userId: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--entityId=')) out.entityId = a.slice('--entityId='.length);
    else if (a.startsWith('--kind=')) out.kind = a.slice('--kind='.length);
    else if (a.startsWith('--userId=')) out.userId = a.slice('--userId='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.entityId) {
    console.error('缺少 --entityId=<DATA_SOURCE_ID>');
    process.exit(1);
  }
  if (!['kpi', 'org'].includes(args.kind)) {
    console.error('--kind 须为 kpi 或 org');
    process.exit(1);
  }

  // 从仓库根解析到 api 服务
  const apiRoot = path.resolve(__dirname, '../../api');
  const modulePaths = [path.join(apiRoot, 'node_modules'), path.join(apiRoot, '..', 'node_modules')];
  for (const p of modulePaths) {
    if (fs.existsSync(p) && !module.paths.includes(p)) module.paths.push(p);
  }

  // 模拟 api 的 ~ 别名
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('~/')) {
      return orig.call(this, path.join(apiRoot, request.slice(2)), parent, isMain, options);
    }
    return orig.call(this, request, parent, isMain, options);
  };

  const {
    extractKpiDefinition,
    extractOrgInfo,
    stableFileId,
    KPI_FILENAME,
    ORG_FILENAME,
  } = require(path.join(apiRoot, 'server/services/Knowledge/TableExtractService'));
  const ExcelCellVectorizationService = require(path.join(
    apiRoot,
    'server/services/Files/ExcelCellVectorizationService',
  ));

  const extract =
    args.kind === 'kpi'
      ? await extractKpiDefinition({
          dataSource: {},
          password: '',
          entityId: args.entityId,
          options: { source: 'mock' },
        })
      : await extractOrgInfo({
          dataSource: {},
          password: '',
          entityId: args.entityId,
          options: { source: 'mock' },
        });

  const primaryColumns =
    args.kind === 'kpi' ? ['指标编号', '标准名称'] : ['org_code', 'org_name'];
  const excludedColumns =
    args.kind === 'org'
      ? ['kpi_query_self', 'kpi_query_drilldown', 'scope_note', 'notes']
      : [];

  const svc = new ExcelCellVectorizationService();
  const result = await svc.vectorizeFromRows({
    entityId: args.entityId,
    userId: args.userId,
    fileId: stableFileId(args.kind, args.entityId),
    filename: extract.filename || (args.kind === 'kpi' ? KPI_FILENAME : ORG_FILENAME),
    headers: extract.headers,
    rows: extract.rows,
    primaryColumns,
    excludedColumns,
    sheetName: args.kind === 'kpi' ? '指标定义' : '机构信息',
    replaceExisting: true,
  });

  console.log(JSON.stringify({ success: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
