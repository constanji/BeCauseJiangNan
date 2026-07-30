/**
 * sqlOrgEnforcement.js
 *
 * Because-jn sql-executor 的机构权限强制校验/改写。
 *
 * 语义对齐 DAT 引擎（IndexContextResolver / OrgDataPermissionService）：
 *   - orgCode 不存在 / 已禁用 / 未配置 brchLv → 直接禁用本次查询（DAT: IndexContext.disabled()）
 *   - brchLv=1 → ALL（全部机构，不做限制）
 *   - brchLv=2/3 → SELF_AND_DESCENDANTS（自身 + 全部后代）
 *   - brchLv=4 → SELF（仅自身）
 *
 * 与 DAT 的关键差异：DAT 是在结构化问数管线里生成 SQL 时天然带上 org_code 范围；
 * Because-jn 的 SQL 是模型直接写的自由文本 SQL，这里用正则对 org_code 相关谓词
 * 做「校验 + 收窄式改写」，不依赖完整 SQL 解析：
 *   1) `org_code = '越权值'`            → 直接拒绝执行（无法安全改写单值等式）
 *   2) `org_code IN ('A','B',...)`     → 与可访问范围取交集，收窄后继续执行（只会更严不会更松）
 *   3) SQL 里完全没有 org_code 谓词，但引用了 org_code 列（如 SELECT/GROUP BY）
 *                                       → 注入 `org_code IN (可访问范围)` 限制
 *   4) SQL 完全不涉及 org_code           → 视为非机构维度数据，不做任何改动
 *
 * 由开关 `sqlEnforcementEnabled` 独立控制是否启用（机构权限管理页「SQL 强制校验/改写」），
 * 与 MCP 门禁开关 `enforcementEnabled` 解耦，可分别开关。
 */

'use strict';

const path = require('path');

class OrgScopeViolationError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'OrgScopeViolationError';
    this.meta = meta;
  }
}

function loadMcpContextResolver() {
  try {
    return require('~/server/services/McpContextResolver');
  } catch (e) {
    return require(path.resolve(__dirname, '../../api/server/services/McpContextResolver'));
  }
}

function loadOrgDataScope() {
  try {
    return require('~/server/utils/orgDataScope');
  } catch (e) {
    return require(path.resolve(__dirname, '../../api/server/utils/orgDataScope'));
  }
}

/**
 * 判断本次调用是否需要做机构权限强制校验/改写，并解析出用户的可访问范围。
 * @param {string | null | undefined} orgCode
 * @returns {Promise<
 *   | { enabled: false }
 *   | { enabled: true, blocked: true, reason: string }
 *   | { enabled: true, blocked: false, orgCode: string, scope: 'ALL'|'SELF_AND_DESCENDANTS'|'SELF', accessibleOrgCodes: string[] }
 * >}
 */
async function evaluateOrgSqlEnforcement(orgCode) {
  const { isSqlEnforcementEnabled, getOrgUnits } = loadMcpContextResolver();
  const enabled = await isSqlEnforcementEnabled();
  if (!enabled) {
    return { enabled: false };
  }

  if (orgCode == null || String(orgCode).trim() === '') {
    return {
      enabled: true,
      blocked: true,
      reason:
        '机构权限强制校验已开启，但未获取到当前用户的机构编码（orgCode），出于安全考虑拒绝执行该 SQL。',
    };
  }

  const { resolveAccessibleOrgCodes } = loadOrgDataScope();
  const orgUnits = await getOrgUnits();
  const { scope, orgCodes } = resolveAccessibleOrgCodes(orgCode, orgUnits);
  if (!scope || orgCodes.length === 0) {
    return {
      enabled: true,
      blocked: true,
      reason: `机构编码 ${orgCode} 不存在、已禁用或未配置权限级别，拒绝执行该 SQL。`,
    };
  }

  return { enabled: true, blocked: false, orgCode: String(orgCode), scope, accessibleOrgCodes: orgCodes };
}

/** 去掉字面量两端的引号/反引号并 trim */
function stripQuotes(value) {
  return String(value).trim().replace(/^['"`]+|['"`]+$/g, '');
}

const ORG_CODE_EQ_RE = /\borg_code\b\s*=\s*'([^']*)'/gi;
const ORG_CODE_IN_RE = /\borg_code\b\s+IN\s*\(([^)]*)\)/gi;
const ORG_CODE_MENTION_RE = /\borg_code\b/i;
const TRAILING_CLAUSE_RE = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT)\b/i;

/**
 * 对 SQL 做机构范围校验 + 收窄式改写。
 * 只在 scope !== 'ALL' 时生效；ALL 视为无限制直接放行。
 *
 * @param {string} sql
 * @param {{ scope: string, accessibleOrgCodes: string[] }} params
 * @returns {{ sql: string, narrowed: boolean }}
 * @throws {OrgScopeViolationError} 命中越权 org_code 或无法安全校验的动态子查询
 */
function enforceOrgScopeOnSql(sql, { scope, accessibleOrgCodes }) {
  if (scope === 'ALL') {
    return { sql, narrowed: false };
  }
  if (!ORG_CODE_MENTION_RE.test(sql)) {
    // SQL 完全没提到 org_code 列，判定为非机构维度数据查询，不做任何改动
    return { sql, narrowed: false };
  }

  const allowedSet = new Set(accessibleOrgCodes.map(String));
  const allowedList = [...allowedSet];

  // 1) 等式谓词：命中越权值直接拒绝（单值等式无法安全收窄）
  let eqMatchCount = 0;
  let m;
  const eqRe = new RegExp(ORG_CODE_EQ_RE);
  while ((m = eqRe.exec(sql)) !== null) {
    eqMatchCount += 1;
    if (!allowedSet.has(m[1])) {
      throw new OrgScopeViolationError(
        `机构编码 ${m[1]} 超出当前用户可访问范围，拒绝执行该 SQL。`,
        { code: 'ORG_CODE_OUT_OF_SCOPE', orgCode: m[1] },
      );
    }
  }

  // 2) IN(...) 谓词：与可访问范围取交集收窄；含子查询时无法静态校验，直接拒绝
  let hasInClause = false;
  let narrowed = false;
  const inRe = new RegExp(ORG_CODE_IN_RE);
  const rewritten = sql.replace(inRe, (full, inner) => {
    hasInClause = true;
    if (/\bSELECT\b/i.test(inner)) {
      throw new OrgScopeViolationError(
        '机构权限强制模式下，org_code IN 子句不支持动态子查询，请改用字面量机构编码列表。',
        { code: 'ORG_CODE_DYNAMIC_SUBQUERY' },
      );
    }
    const codes = inner
      .split(',')
      .map((s) => stripQuotes(s))
      .filter(Boolean);
    const kept = codes.filter((c) => allowedSet.has(c));
    if (kept.length === 0) {
      throw new OrgScopeViolationError(
        `机构编码 ${codes.join(', ')} 均超出当前用户可访问范围，拒绝执行该 SQL。`,
        { code: 'ORG_CODE_OUT_OF_SCOPE', orgCodes: codes },
      );
    }
    if (kept.length < codes.length) {
      narrowed = true;
    }
    return `org_code IN (${kept.map((c) => `'${c}'`).join(', ')})`;
  });

  if (eqMatchCount > 0 || hasInClause) {
    return { sql: rewritten, narrowed };
  }

  // 3) 提到了 org_code 列（如 SELECT org_code 或 GROUP BY org_code）但没有任何过滤谓词
  //    → 注入 WHERE 限制到可访问范围内，避免跨机构数据泄露
  const injected = `org_code IN (${allowedList.map((c) => `'${c}'`).join(', ')})`;
  let injectedSql;
  if (/\bWHERE\b/i.test(sql)) {
    injectedSql = sql.replace(/\bWHERE\b/i, `WHERE (${injected}) AND `);
  } else if (TRAILING_CLAUSE_RE.test(sql)) {
    injectedSql = sql.replace(TRAILING_CLAUSE_RE, (kw) => `WHERE ${injected} ${kw}`);
  } else {
    injectedSql = `${sql.trimEnd().replace(/;$/, '')} WHERE ${injected}`;
  }
  return { sql: injectedSql, narrowed: true };
}

module.exports = {
  OrgScopeViolationError,
  evaluateOrgSqlEnforcement,
  enforceOrgScopeOnSql,
};
