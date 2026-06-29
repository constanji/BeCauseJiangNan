const {
  testConnection,
  listSchemas,
  listTables,
  getTableSchema,
  toDDL,
  isTextType,
} = require('./DatabaseService');

module.exports = { getTableSchema, listTables, listSchemas, toDDL, isTextType, testConnection };
