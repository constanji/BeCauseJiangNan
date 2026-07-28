/**
 * JN 平台机构权限 dataScope 工具
 * 语义对齐 DAT：brchLv 1-4 → ALL / SELF_AND_DESCENDANTS / SELF
 */

/** @typedef {'ALL' | 'SELF_AND_DESCENDANTS' | 'SELF'} OrgDataScope */

/**
 * @param {number | null | undefined} brchLv
 * @returns {OrgDataScope | null}
 */
function deriveDataScope(brchLv) {
  const lv = Number(brchLv);
  if (lv === 1) {
    return 'ALL';
  }
  if (lv === 2 || lv === 3) {
    return 'SELF_AND_DESCENDANTS';
  }
  if (lv === 4) {
    return 'SELF';
  }
  return null;
}

/**
 * 收集自身 + 全部后代（BFS，按 parentOrgCode）
 * @param {string} orgCode
 * @param {Array<{ orgCode: string, parentOrgCode?: string | null, enabled?: boolean }>} orgUnits
 * @returns {string[]}
 */
function collectDescendants(orgCode, orgUnits) {
  const childrenByParent = new Map();
  for (const unit of orgUnits) {
    if (unit.enabled === false) {
      continue;
    }
    const parent = unit.parentOrgCode == null || unit.parentOrgCode === ''
      ? null
      : String(unit.parentOrgCode);
    if (!parent) {
      continue;
    }
    if (!childrenByParent.has(parent)) {
      childrenByParent.set(parent, []);
    }
    childrenByParent.get(parent).push(String(unit.orgCode));
  }

  const result = [];
  const queue = [String(orgCode)];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    result.push(current);
    const children = childrenByParent.get(current) || [];
    for (const child of children) {
      if (!seen.has(child)) {
        queue.push(child);
      }
    }
  }
  return result;
}

/**
 * @param {string} orgCode
 * @param {Array<{ orgCode: string, parentOrgCode?: string | null, brchLv?: number | null, enabled?: boolean }>} orgUnits
 * @returns {{ scope: OrgDataScope | null, orgCodes: string[] }}
 */
function resolveAccessibleOrgCodes(orgCode, orgUnits = []) {
  if (orgCode == null || orgCode === '') {
    return { scope: null, orgCodes: [] };
  }
  const code = String(orgCode);
  const self = orgUnits.find((u) => String(u.orgCode) === code && u.enabled !== false);
  if (!self) {
    return { scope: null, orgCodes: [] };
  }

  const scope = deriveDataScope(self.brchLv);
  if (scope === 'ALL') {
    return {
      scope,
      orgCodes: orgUnits.filter((u) => u.enabled !== false).map((u) => String(u.orgCode)),
    };
  }
  if (scope === 'SELF') {
    return { scope, orgCodes: [code] };
  }
  if (scope === 'SELF_AND_DESCENDANTS') {
    return { scope, orgCodes: collectDescendants(code, orgUnits) };
  }
  return { scope: null, orgCodes: [] };
}

/**
 * 扁平列表 → 树
 * @param {Array<object>} units
 * @returns {Array<object>}
 */
function buildOrgTree(units = []) {
  const byCode = new Map();
  for (const unit of units) {
    byCode.set(String(unit.orgCode), {
      ...unit,
      orgCode: String(unit.orgCode),
      dataScope: deriveDataScope(unit.brchLv),
      children: [],
    });
  }

  const roots = [];
  for (const node of byCode.values()) {
    const parent =
      node.parentOrgCode == null || node.parentOrgCode === ''
        ? null
        : String(node.parentOrgCode);
    if (parent && byCode.has(parent)) {
      byCode.get(parent).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * 规范化导入行（对齐 DAT 列名或简化列名）
 * @param {Record<string, unknown>} row
 * @returns {{ orgCode: string, orgName: string, parentOrgCode: string | null, brchLv: number | null, dataDt: string | null } | null}
 */
function normalizeOrgImportRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const lower = {};
  for (const [k, v] of Object.entries(row)) {
    lower[String(k).trim().toLowerCase()] = v;
  }

  const orgCode = String(lower.orgcode ?? lower.brchno ?? lower.org_code ?? '').trim();
  if (!orgCode) {
    return null;
  }

  const orgName = String(lower.orgname ?? lower.brchna ?? lower.org_name ?? '').trim();
  let parentRaw = lower.parentorgcode ?? lower.brchup ?? lower.parent_org_code ?? null;
  if (parentRaw != null) {
    parentRaw = String(parentRaw).trim();
  }
  // DAT 约定：00000 视为根
  const parentOrgCode =
    !parentRaw || parentRaw === '00000' || parentRaw === '0' ? null : parentRaw;

  const brchLvRaw = lower.brchlv ?? lower.brch_lv ?? lower.level ?? null;
  let brchLv = null;
  if (brchLvRaw != null && brchLvRaw !== '') {
    const n = Number(brchLvRaw);
    if (Number.isFinite(n) && n >= 1 && n <= 4) {
      brchLv = n;
    }
  }

  const dataDtRaw = lower.data_dt ?? lower.datadt ?? lower.dataDt ?? null;
  const dataDt = dataDtRaw != null && dataDtRaw !== '' ? String(dataDtRaw).trim() : null;

  return { orgCode, orgName, parentOrgCode, brchLv, dataDt };
}

/**
 * 取最新 data_dt 快照并按 orgCode 去重
 * @param {Array<{ orgCode: string, dataDt?: string | null }>} rows
 */
function pickLatestSnapshot(rows) {
  if (!rows.length) {
    return [];
  }
  const withDt = rows.filter((r) => r.dataDt);
  if (!withDt.length) {
    const byCode = new Map();
    for (const row of rows) {
      byCode.set(row.orgCode, row);
    }
    return [...byCode.values()];
  }
  let maxDt = withDt[0].dataDt;
  for (const row of withDt) {
    if (String(row.dataDt) > String(maxDt)) {
      maxDt = row.dataDt;
    }
  }
  const byCode = new Map();
  for (const row of rows) {
    if (row.dataDt == null || String(row.dataDt) === String(maxDt)) {
      byCode.set(row.orgCode, row);
    }
  }
  return [...byCode.values()];
}

module.exports = {
  deriveDataScope,
  collectDescendants,
  resolveAccessibleOrgCodes,
  buildOrgTree,
  normalizeOrgImportRow,
  pickLatestSnapshot,
};
