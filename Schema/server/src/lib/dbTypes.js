const VALID_TYPES = ['mysql', 'postgresql', 'gaussdb', 'mock'];

const UNSUPPORTED_MSG = '该数据库类型后端尚未支持，当前仅 GaussDB、MySQL 与 Mock 可用';

function normalizeType(value) {
  const type = String(value || 'gaussdb').toLowerCase();
  if (!VALID_TYPES.includes(type)) return null;
  return type;
}

function isSupportedType(type) {
  return type === 'gaussdb' || type === 'mysql' || type === 'mock';
}

class UnsupportedDbTypeError extends Error {
  constructor(type) {
    super(UNSUPPORTED_MSG);
    this.name = 'UnsupportedDbTypeError';
    this.code = 'UNSUPPORTED_DB_TYPE';
    this.status = 501;
    this.type = type;
  }
}

module.exports = {
  VALID_TYPES,
  UNSUPPORTED_MSG,
  normalizeType,
  isSupportedType,
  UnsupportedDbTypeError,
};
