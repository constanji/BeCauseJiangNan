const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function level() {
  return LEVELS[process.env.MODEL_PROBE_LOG_LEVEL || 'info'] ?? 1;
}

function log(lvl, msg, meta) {
  if (LEVELS[lvl] < level()) return;
  const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  const fn = lvl === 'error' ? console.error : console.log;
  fn(`[ModelProbe:${lvl}] ${line}`);
}

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
