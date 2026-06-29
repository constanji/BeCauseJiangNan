function parseContent(content) {
  if (!content) return null;
  if (typeof content === 'object') return content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function buildColumnSearchText(content) {
  const obj = parseContent(content);
  if (!obj?.columns) return '';
  return obj.columns
    .map((c) => String(c.description || '').trim())
    .filter(Boolean)
    .join(' ');
}

function getColumnCount(content) {
  const obj = parseContent(content);
  return Array.isArray(obj?.columns) ? obj.columns.length : 0;
}

function buildSnippet(text, query, radius = 24) {
  const source = String(text || '');
  const needle = String(query || '').trim();
  if (!needle) return source.slice(0, radius * 2);
  const lower = source.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) return source.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(source.length, idx + needle.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < source.length ? '…' : '';
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

module.exports = {
  parseContent,
  buildColumnSearchText,
  getColumnCount,
  buildSnippet,
};
