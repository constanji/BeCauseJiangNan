function parseContent(content) {
  if (!content) return null;
  if (typeof content === 'object') return content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function columnSearchParts(col) {
  const name = String(col.name || '').trim();
  const desc = String(col.description || '').trim();
  return [name, desc].filter(Boolean);
}

function buildColumnSearchText(content) {
  const obj = parseContent(content);
  if (!obj?.columns) return '';
  return obj.columns
    .flatMap(columnSearchParts)
    .join(' ');
}

function columnMatchesQuery(col, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return false;
  return columnSearchParts(col).some((part) => part.toLowerCase().includes(needle));
}

function buildColumnMatchSnippet(col, query) {
  const needle = String(query || '').trim().toLowerCase();
  const desc = String(col.description || '');
  const name = String(col.name || '');
  if (desc.toLowerCase().includes(needle)) return buildSnippet(desc, query);
  if (name.toLowerCase().includes(needle)) return buildSnippet(name, query);
  return buildSnippet(desc || name, query);
}

function normalizeSearchLike(query) {
  return `%${String(query || '').trim().toLowerCase()}%`;
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

function columnSampleParts(col) {
  if (!Array.isArray(col?.sampleValues)) return [];
  return col.sampleValues.map((v) => String(v ?? '').trim()).filter(Boolean);
}

function columnMatchesSampleQuery(col, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return false;
  return columnSampleParts(col).some((part) => part.toLowerCase().includes(needle));
}

function matchedSampleValues(col, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  return columnSampleParts(col).filter((part) => part.toLowerCase().includes(needle));
}

function buildSampleMatchSnippet(col, query) {
  const hits = matchedSampleValues(col, query);
  if (hits.length > 0) return buildSnippet(hits[0], query);
  const joined = columnSampleParts(col).join(', ');
  return buildSnippet(joined, query);
}

module.exports = {
  parseContent,
  buildColumnSearchText,
  getColumnCount,
  buildSnippet,
  columnMatchesQuery,
  buildColumnMatchSnippet,
  columnSampleParts,
  columnMatchesSampleQuery,
  matchedSampleValues,
  buildSampleMatchSnippet,
  normalizeSearchLike,
};
