function asciiFallbackFilename(filename) {
  const name = String(filename || 'export.xlsx').trim() || 'export.xlsx';
  if (!/[^\x00-\x7F]/.test(name)) {
    return name.replace(/["\\]/g, '_');
  }
  const extMatch = name.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : '.xlsx';
  const stem = name.slice(0, name.length - ext.length);
  const asciiStem = stem
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/["\\]/g, '_')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (asciiStem.length >= 3) return `${asciiStem}${ext}`;
  const date = new Date().toISOString().slice(0, 10);
  return `export-${date}${ext}`;
}

function buildAttachmentContentDisposition(filename) {
  const name = String(filename || 'export.xlsx').trim() || 'export.xlsx';
  const fallback = asciiFallbackFilename(name);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

module.exports = { asciiFallbackFilename, buildAttachmentContentDisposition };
