/**
 * OrgMasterBuilder — 从 c_par_brch_level 去重行构建 org_master 结构
 * 列对齐 数据表/org_master.xlsx；派生逻辑参考 parse-org-tree.mjs
 *
 * 输入：brchno/brchna/brchup/brchlv（必填）+ 可选 brchup_name/brsmna/corpno/cityno_name/org_label 等
 * 输出：完整 org_master 15 列（含 leaf_child_codes / kpi_query_* 等），供知识检索
 */

const REGION_CODES = new Set([
  'A0000', 'A0700', 'A0800', 'A0900', 'A1000', 'A1100', 'A0400', 'A0500',
]);

const ORG_MASTER_HEADERS = [
  'org_code',
  'org_name',
  'org_level',
  'org_level_name',
  'parent_org_code',
  'parent_org_name',
  'region_org_code',
  'scope_note',
  'leaf_child_codes',
  'leaf_child_orgs',
  'same_level_codes',
  'same_level_orgs',
  'kpi_query_self',
  'kpi_query_drilldown',
  'notes',
];

/** 从 c_par_brch_level 可选拉取的补充列（有则用，无则跳过） */
const ORG_SOURCE_OPTIONAL_COLS = [
  'brchup_name',
  'brsmna',
  'corpno',
  'corpno_name',
  'cityno',
  'cityno_name',
  'pribrhno',
  'pribrhno_name',
  'org_label',
  'business_status',
  'brtype',
];

const ORG_SOURCE_REQUIRED_SELECT = ['brchno', 'brchna', 'brchup', 'brchlv'];

function inferOrgLevelByCode(code) {
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

function inferOrgLevel(code, brchLv) {
  const byCode = inferOrgLevelByCode(code);
  if (brchLv != null && brchLv !== '' && !Number.isNaN(Number(brchLv))) {
    const lv = Number(brchLv);
    // brchlv 为准；级别名优先用机构号推断（对齐 org_master / parse-org-tree）
    if (byCode.org_level === lv) {
      return { org_level: lv, org_level_name: byCode.org_level_name };
    }
    const nameMap = {
      0: '银行',
      1: '法人机构',
      2: '分行/总行部室',
      3: '一级支行/管理行',
      4: '二级支行/网点',
    };
    return { org_level: lv, org_level_name: nameMap[lv] || byCode.org_level_name || `级别${lv}` };
  }
  return byCode;
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

/** 对齐 org_master / parse-org-tree：`A0001 武进支行` */
function formatOrgEntry(code, nodes) {
  const n = nodes.get(code);
  if (!n) return code;
  return `${code} ${n.org_name}`;
}

function formatOrgList(codes, nodes, separator = '；') {
  return codes.map((c) => formatOrgEntry(c, nodes)).join(separator);
}

function buildScopeNote(raw, levelInfo) {
  const parts = [];
  if (raw.org_label) parts.push(`标签:${String(raw.org_label).trim()}`);
  if (raw.cityno_name) parts.push(`分行:${String(raw.cityno_name).trim()}`);
  else if (raw.cityno) parts.push(`分行号:${String(raw.cityno).trim()}`);
  if (raw.corpno_name) parts.push(`法人:${String(raw.corpno_name).trim()}`);
  else if (raw.corpno) parts.push(`法人:${String(raw.corpno).trim()}`);
  if (raw.pribrhno_name) parts.push(`一级支行:${String(raw.pribrhno_name).trim()}`);
  if (raw.brsmna && String(raw.brsmna).trim() !== String(raw.brchna || '').trim()) {
    parts.push(`简称:${String(raw.brsmna).trim()}`);
  }
  if (raw.business_status != null && String(raw.business_status).trim() !== '') {
    parts.push(`状态:${String(raw.business_status).trim()}`);
  }
  if (!parts.length && levelInfo.org_level_name) {
    return levelInfo.org_level_name;
  }
  return parts.join('；');
}

/**
 * @param {Array<Record<string, any>>} rawRows  c_par_brch_level 去重后的行
 * @returns {{ headers: string[], rows: Record<string,string>[], rowCount: number }}
 */
function buildOrgMasterFromBrchRows(rawRows) {
  const nodes = new Map();
  const children = new Map();

  for (const raw of rawRows || []) {
    const code = String(raw.brchno || raw.org_code || '').trim();
    if (!code) continue;
    let parent = String(raw.brchup || raw.parent_org_code || '').trim();
    if (parent === code) parent = '';
    // 名称优先正式名，简称进 scope_note
    const name = String(raw.brchna || raw.org_name || raw.brsmna || code).trim();
    const levelInfo = inferOrgLevel(code, raw.brchlv ?? raw.org_level);
    const parentNameFromSrc = String(raw.brchup_name || '').trim();

    nodes.set(code, {
      org_code: code,
      org_name: name,
      org_level: levelInfo.org_level,
      org_level_name: levelInfo.org_level_name,
      parent_org_code: parent,
      parent_org_name: parentNameFromSrc,
      region_org_code: '',
      scope_note: buildScopeNote(raw, levelInfo),
      leaf_child_codes: '',
      leaf_child_orgs: '',
      same_level_codes: '',
      same_level_orgs: '',
      kpi_query_self: `org_code='${code}'`,
      kpi_query_drilldown: '',
      notes: '',
      _brsmna: String(raw.brsmna || '').trim(),
    });
  }

  for (const node of nodes.values()) {
    if (node.parent_org_code && !nodes.has(node.parent_org_code)) {
      node.notes = [node.notes, `父节点缺失: ${node.parent_org_code}`].filter(Boolean).join('；');
      // 保留源表带的上级名，便于检索
      if (!node.parent_org_name) {
        node.parent_org_code = '';
      }
    }
  }

  for (const node of nodes.values()) {
    if (!node.parent_org_code) continue;
    if (!children.has(node.parent_org_code)) children.set(node.parent_org_code, []);
    children.get(node.parent_org_code).push(node.org_code);
  }

  // 稳定子节点顺序
  for (const [p, list] of children.entries()) {
    list.sort((a, b) => a.localeCompare(b));
    children.set(p, list);
  }

  for (const node of nodes.values()) {
    if (node.parent_org_code && nodes.has(node.parent_org_code)) {
      // 树内父名优先覆盖源表 brchup_name（保持一致）
      node.parent_org_name = nodes.get(node.parent_org_code).org_name;
    }
    node.region_org_code = findRegionCode(nodes, node.org_code);

    const directChildren = (children.get(node.org_code) || []).filter((c) => c !== node.org_code);
    if (directChildren.length > 0) {
      node.leaf_child_codes = directChildren.join(',');
      node.leaf_child_orgs = formatOrgList(directChildren, nodes);
      const inList = directChildren.map((c) => `'${c}'`).join(',');
      node.kpi_query_drilldown = `org_code IN (${inList})`;
    }

    if (node.parent_org_code) {
      const siblings = (children.get(node.parent_org_code) || [])
        .map((c) => nodes.get(c))
        .filter(
          (n) =>
            n &&
            n.org_level_name === node.org_level_name &&
            Number(n.org_level) === Number(node.org_level),
        )
        .map((n) => n.org_code);
      if (siblings.length > 1) {
        node.same_level_codes = siblings.join(',');
        node.same_level_orgs = formatOrgList(siblings, nodes);
      }
    }
  }

  const rows = [...nodes.values()].map((n) => {
    const out = {};
    for (const h of ORG_MASTER_HEADERS) {
      out[h] = n[h] == null ? '' : String(n[h]);
    }
    return out;
  });

  // 按机构号排序，便于预览对照 org_master
  rows.sort((a, b) => a.org_code.localeCompare(b.org_code));

  return {
    headers: [...ORG_MASTER_HEADERS],
    rows,
    rowCount: rows.length,
  };
}

module.exports = {
  ORG_MASTER_HEADERS,
  ORG_SOURCE_OPTIONAL_COLS,
  ORG_SOURCE_REQUIRED_SELECT,
  inferOrgLevel,
  inferOrgLevelByCode,
  buildOrgMasterFromBrchRows,
};
