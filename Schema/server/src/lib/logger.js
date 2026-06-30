function timestamp() {
  return new Date().toISOString();
}

function isDebugEnabled() {
  const level = String(process.env.SCHEMA_LOG_LEVEL || '').toLowerCase();
  if (level === 'debug') return true;
  return process.env.NODE_ENV !== 'production';
}

function write(level, message, extra) {
  const line = extra === undefined
    ? `[Schema] ${timestamp()} ${level} ${message}`
    : `[Schema] ${timestamp()} ${level} ${message} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
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
