const { formatDuration, progressPrefix } = require('./formatDuration');

function timestamp() {
  return new Date().toISOString();
}

function isDebugEnabled() {
  const level = String(process.env.SCHEMA_LOG_LEVEL || '').toLowerCase();
  if (level === 'debug') return true;
  return process.env.NODE_ENV !== 'production';
}

function formatExtra(extra) {
  if (extra === undefined) return '';
  if (typeof extra === 'string') return extra;
  const parts = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'elapsedMs') {
      parts.push(`耗时 ${formatDuration(Number(value))}`);
      continue;
    }
    parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? ` | ${parts.join(' | ')}` : '';
}

function write(level, message, extra) {
  const line = `[Schema] ${timestamp()} ${level} ${message}${formatExtra(extra)}`;
  if (level === 'ERROR') {
    console.error(line);
    return;
  }
  if (level === 'WARN') {
    console.warn(line);
    return;
  }
  console.log(line);
}

module.exports = {
  info(message, extra) {
    write('INFO', message, extra);
  },
  warn(message, extra) {
    write('WARN', message, extra);
  },
  error(message, extra) {
    write('ERROR', message, extra);
  },
  debug(message, extra) {
    if (!isDebugEnabled()) return;
    write('DEBUG', message, extra);
  },
};
