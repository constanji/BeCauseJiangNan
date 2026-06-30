/** 将毫秒格式化为可读时长，如 8m19s、1h2m */
function formatDuration(ms) {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  if (n < 1000) return `${n}ms`;
  const s = Math.floor(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h${rm}m` : `${h}h`;
}

function progressPrefix(progress) {
  if (!progress || !Number.isFinite(progress.index) || !Number.isFinite(progress.total)) {
    return '';
  }
  const index = Math.max(1, Math.floor(progress.index));
  const total = Math.max(index, Math.floor(progress.total));
  return `[${index}/${total}]`;
}

module.exports = { formatDuration, progressPrefix };
