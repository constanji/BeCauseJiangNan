#!/usr/bin/env node
/**
 * 解析 机构关系.txt → org_master.xlsx
 * leaf_child_codes：仅填树状结构的**直接下一级**子节点（单层），不递归汇总所有末级网点
 * 用法: node Because-2.0/数据表/scripts/parse-org-tree.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('../../../node_modules/xlsx');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(__dirname, '../机构关系.txt');
const OUTPUT = path.resolve(__dirname, '../org_master.xlsx');

const REGION_CODES = new Set([
  'A0000', 'A0700', 'A0800', 'A0900', 'A1000', 'A1100', 'A0400', 'A0500',
]);

const PARENT_OVERRIDES = {
  '01050': 'A0007',
};

const SKIP_NAME_PATTERNS = [
  /^例如/,
  /^包含所有/,
  /^注：/,
  /^此部门直属/,
  /下的其他直属/,
  /独立法人$/,
  /合作行/,
  /数据录入问题/,
  /无下级$/,
  /本身也是/,
];

const CODE_RE = /^[A-Z0-9]{4,6}$/;

function inferOrgLevel(code) {
  if (code === '00000') return { org_level: 0, org_level_name: '银行' };
  if (/^FR\d{3}$/.test(code)) return { org_level: 1, org_level_name: '法人机构' };
  if (code === 'A8000') return { org_level: 2, org_level_name: '总行部室' };
  if (REGION_CODES.has(code)) return { org_level: 2, org_level_name: '区域分行' };
  if (/^A\d{4}$/.test(code)) return { org_level: 3, org_level_name: '管理行' };
  if (/^B\d{4}$/.test(code) || /^C\d{4}$/.test(code)) return { org_level: 2, org_level_name: '村镇银行' };
  if (/^D\d{4}$/.test(code)) return { org_level: 5, org_level_name: '大客户团队' };
  if (/^WD\d{3}$/.test(code) || /^W\d{4}$/.test(code)) return { org_level: 5, org_level_name: '小微团队' };
  if (/^XN\d{3}$/.test(code)) return { org_level: 2, org_level_name: '合作行' };
  if (code === '0100') return { org_level: 99, org_level_name: '特殊节点' };
  if (/^80\d{3}$/.test(code)) return { org_level: 3, org_level_name: '总行部门' };
  if (/9999$/.test(code)) return { org_level: 4, org_level_name: '管理机构' };
  if (/8888$/.test(code)) return { org_level: 4, org_level_name: '清算中心' };
  if (/^\d{5}$/.test(code)) return { org_level: 4, org_level_name: '网点' };
  return { org_level: 4, org_level_name: '网点' };
}

function cleanName(raw) {
  let name = String(raw || '').trim();
  name = name.replace(/\(\*\*[^*]+\*\*[^)]*\)/g, '').trim();
  name = name.replace(/\([^)]*修正[^)]*\)/g, '').trim();
  name = name.replace(/\([^)]*重复[^)]*\)/g, '').trim();
  name = name.replace(/\s*->.*$/, '').trim();
  name = name.replace(/\*+$/, '').trim();
  return name;
}

function extractScopeNote(line) {
  const m = line.match(/\(\*\*([^*]+)\*\*[^)]*\)/);
  if (m) return m[1].replace(/[🔴🟢🟡🔵]/g, '').trim();
  const p = line.match(/\(([^)]+权限[^)]*)\)/);
  return p ? p[1].trim() : '';
}

function parseLine(line) {
  if (!line.trim() || line.trim().startsWith('#')) return null;
  const bullet = line.match(/^(\s*)\*\s+(.*)$/);
  if (!bullet) return null;

  const indent = bullet[1].length;
  const body = bullet[2].trim();

  if (body.startsWith('例如') || body.startsWith('注：') || body.startsWith('*包含')) return null;

  const bold = body.match(/^\*\*([A-Z0-9]+)\*\*\s*(.+)$/);
  if (bold) {
    const code = bold[1];
    const name = cleanName(bold[2]);
    if (!name || SKIP_NAME_PATTERNS.some((re) => re.test(name))) return null;
    return { code, name, indent, scope_note: extractScopeNote(body) };
  }

  if (body.startsWith('*')) return null;

  const plain = body.match(/^([A-Z0-9]{4,6})\s+(.+)$/);
  if (plain && CODE_RE.test(plain[1])) {
    const code = plain[1];
    const name = cleanName(plain[2]);
    if (!name || SKIP_NAME_PATTERNS.some((re) => re.test(name))) return null;
    if (body.includes('->') && body.includes('修正') && !body.match(/^\*\*/)) {
      return { code, name, indent, scope_note: '', notes: body.replace(/^\S+\s*/, '') };
    }
    return { code, name, indent, scope_note: '' };
  }

  return null;
}

function findRegionCode(nodes, code) {
  let cur = nodes.get(code);
  const visited = new Set();
  while (cur) {
    if (visited.has(cur.org_code)) break;
    visited.add(cur.org_code);
    if (REGION_CODES.has(cur.org_code)) return cur.org_code;
    if (cur.parent_org_code) cur = nodes.get(cur.parent_org_code);
    else break;
  }
  return '';
}

function getDirectChildCodes(code, children) {
  return (children.get(code) || []).filter((c) => c !== code);
}

function formatOrgList(codes, nodes, { separator = '；' } = {}) {
  return codes
    .map((c) => {
      const n = nodes.get(c);
      return n ? `${c} ${n.org_name}` : c;
    })
    .join(separator);
}

function buildRows(rawText) {
  const stack = [];
  const nodes = new Map();
  const order = [];

  for (const line of rawText.split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    while (stack.length > 0 && stack[stack.length - 1].indent >= parsed.indent) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const parentCode = PARENT_OVERRIDES[parsed.code] || parent?.code || '';
    const { org_level, org_level_name } = inferOrgLevel(parsed.code);

    const node = {
      org_code: parsed.code,
      org_name: parsed.name,
      org_level,
      org_level_name,
      parent_org_code: parentCode,
      parent_org_name: parentCode ? (nodes.get(parentCode)?.org_name || '') : '',
      region_org_code: '',
      scope_note: parsed.scope_note || '',
      leaf_child_codes: '',
      leaf_child_orgs: '',
      same_level_codes: '',
      same_level_orgs: '',
      kpi_query_self: '',
      kpi_query_drilldown: '',
      notes: parsed.notes || '',
    };

    nodes.set(parsed.code, node);
    order.push(parsed.code);
    stack.push({ code: parsed.code, indent: parsed.indent, name: parsed.name });
  }

  // 应用 parent override
  for (const code of Object.keys(PARENT_OVERRIDES)) {
    const node = nodes.get(code);
    const parent = nodes.get(PARENT_OVERRIDES[code]);
    if (node && parent) {
      node.parent_org_code = parent.org_code;
      node.parent_org_name = parent.org_name;
      node.notes = [node.notes, `数据归属修正为 ${parent.org_code}`].filter(Boolean).join('；');
    }
  }

  // 构建 children 映射
  const children = new Map();
  for (const node of nodes.values()) {
    if (!node.parent_org_code) continue;
    if (!children.has(node.parent_org_code)) children.set(node.parent_org_code, []);
    children.get(node.parent_org_code).push(node.org_code);
  }

  const byName = new Map();
  for (const node of nodes.values()) {
    if (!byName.has(node.org_name)) byName.set(node.org_name, []);
    byName.get(node.org_name).push(node.org_code);
  }

  for (const code of order) {
    const node = nodes.get(code);
    node.region_org_code = findRegionCode(nodes, code);

    const directChildren = getDirectChildCodes(code, children);
    if (directChildren.length > 0) {
      node.leaf_child_codes = directChildren.join(',');
      node.leaf_child_orgs = formatOrgList(directChildren, nodes);
    }

    if (node.parent_org_code) {
      const siblings = (children.get(node.parent_org_code) || [])
        .map((c) => nodes.get(c))
        .filter((n) => n && n.org_level_name === node.org_level_name && n.org_level === node.org_level)
        .map((n) => n.org_code);
      if (siblings.length > 1) {
        node.same_level_codes = siblings.join(',');
        node.same_level_orgs = formatOrgList(siblings, nodes);
      }
    }

    node.kpi_query_self = `org_code='${node.org_code}'`;
    if (node.leaf_child_codes) {
      const inList = node.leaf_child_codes.split(',').map((c) => `'${c}'`).join(',');
      node.kpi_query_drilldown = `org_code IN (${inList})`;
    }

    const dupes = (byName.get(node.org_name) || []).filter((c) => c !== node.org_code);
    if (dupes.length > 0) {
      node.notes = [node.notes, `同名机构: ${dupes.join(',')}`].filter(Boolean).join('；');
    }
  }

  return order.map((code) => nodes.get(code));
}

function levelDictSheet() {
  return [
    ['org_level', 'org_level_name', 'code_pattern', 'kpi_query_rule'],
    [0, '银行', '00000', '汇总行，kpi_result_ctcx 查询时排除'],
    [1, '法人机构', 'FR001-FR003', '汇总/法人根节点'],
    [2, '区域分行', 'A0000/A0700/...', '区域全辖；排名 SQL 通常排除 A0000'],
    [2, '总行部室', 'A8000/80xxx', '总行条线，超级权限全行可见'],
    [3, '管理行', 'A0001-A0010 等', "查本级: org_code='A0002'；下钻下一级: 用 leaf_child_codes（仅直接子节点）"],
    [4, '网点', '01xxx-13xxx 等', "查本级: org_code='01011'"],
    [5, '大客户团队', 'D01xx', '按单码查询；父级 leaf_child_codes 含本团队'],
    [5, '小微团队', 'W/WD 前缀', '垂直条线团队'],
  ];
}

function main() {
  const raw = fs.readFileSync(INPUT, 'utf8');
  const rows = buildRows(raw);

  const headers = [
    'org_code', 'org_name', 'org_level', 'org_level_name',
    'parent_org_code', 'parent_org_name', 'region_org_code',
    'scope_note',
    'leaf_child_codes', 'leaf_child_orgs',
    'same_level_codes', 'same_level_orgs',
    'kpi_query_self', 'kpi_query_drilldown', 'notes',
  ];

  const masterData = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(masterData), 'org_master');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(levelDictSheet()), 'org_level_dict');
  XLSX.writeFile(wb, OUTPUT);

  const a0002 = rows.find((r) => r.org_code === 'A0002');
  const fr001 = rows.find((r) => r.org_code === 'FR001');
  const root = rows.find((r) => r.org_code === '00000');
  console.log(`已生成 ${OUTPUT}`);
  console.log(`共 ${rows.length} 条机构`);
  if (root) {
    console.log(`00000: leaf_count=${root.leaf_child_codes.split(',').filter(Boolean).length}, children=${root.leaf_child_codes}`);
  }
  if (fr001) {
    console.log(`FR001: leaf_count=${fr001.leaf_child_codes.split(',').filter(Boolean).length}, children=${fr001.leaf_child_codes}`);
  }
  if (a0002) {
    console.log(`A0002: level=${a0002.org_level_name}, leaf_count=${a0002.leaf_child_codes.split(',').filter(Boolean).length}, parent=${a0002.parent_org_code}`);
  }
}

main();
