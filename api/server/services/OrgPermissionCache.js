/**
 * 机构权限配置缓存（供 Controller 写入后失效，Resolver 读取）
 */
let settingsCache = { value: null, expiresAt: 0 };
let orgUnitsCache = { value: null, expiresAt: 0 };
const CACHE_TTL_MS = 30 * 1000;

function getSettingsCache() {
  return settingsCache;
}

function setSettingsCache(value) {
  settingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

function getOrgUnitsCache() {
  return orgUnitsCache;
}

function setOrgUnitsCache(value) {
  orgUnitsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

function invalidateOrgPermissionCache() {
  settingsCache = { value: null, expiresAt: 0 };
  orgUnitsCache = { value: null, expiresAt: 0 };
}

module.exports = {
  CACHE_TTL_MS,
  getSettingsCache,
  setSettingsCache,
  getOrgUnitsCache,
  setOrgUnitsCache,
  invalidateOrgPermissionCache,
};
