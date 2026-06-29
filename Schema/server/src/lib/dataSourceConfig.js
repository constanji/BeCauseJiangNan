function parseSsl(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toConnectionConfig(row) {
  return {
    type: row.type || 'gaussdb',
    host: row.host,
    port: row.port,
    database: row.database_name,
    username: row.username,
    ssl: parseSsl(row.ssl_json),
  };
}

function connectionFromBody(body) {
  return {
    type: body.type || 'gaussdb',
    host: body.host,
    port: Number(body.port),
    database: body.database,
    username: body.username,
    ssl: body.ssl || null,
  };
}

module.exports = { parseSsl, toConnectionConfig, connectionFromBody };
