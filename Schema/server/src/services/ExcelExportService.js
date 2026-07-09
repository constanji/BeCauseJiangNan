const ExcelJS = require('exceljs');

function safeSheetName(name) {
  return String(name || 'sheet').replace(/[\\/*?:[\]]/g, '_').slice(0, 31) || 'sheet';
}

function uniqueSheetName(workbook, base) {
  let name = safeSheetName(base);
  if (!workbook.getWorksheet(name)) return name;
  for (let i = 2; i < 100; i += 1) {
    const candidate = safeSheetName(`${base}_${i}`);
    if (!workbook.getWorksheet(candidate)) return candidate;
  }
  return safeSheetName(`${base}_${Date.now()}`);
}

function sortSchemas(schemas) {
  return [...schemas].sort((a, b) => {
    const ds = String(a.dataSourceName || '').localeCompare(String(b.dataSourceName || ''));
    if (ds !== 0) return ds;
    const sn = String(a.schemaName || '').localeCompare(String(b.schemaName || ''));
    if (sn !== 0) return sn;
    return String(a.tableName || '').localeCompare(String(b.tableName || ''));
  });
}

function toLightSchemaJson(item) {
  return JSON.stringify({
    tableName: item.tableName,
    tableDescription: item.tableDescription || '',
    columns: item.columns || [],
    primaryKeys: item.primaryKeys || [],
  });
}

function addSummarySheet(workbook, schemas, { multiSource = false, dataSourceName = '' } = {}) {
  const summary = workbook.addWorksheet('汇总');
  const header = multiSource
    ? ['数据源', 'Schema', '表名', '表名备注', '主键', 'LightSchema JSON']
    : ['Schema', '表名', '表名备注', '主键', 'LightSchema JSON'];
  summary.addRow(header);
  summary.getRow(1).font = { bold: true };

  for (const item of sortSchemas(schemas)) {
    const row = summary.addRow(multiSource
      ? [
        item.dataSourceName || dataSourceName,
        item.schemaName || '',
        item.tableName,
        item.tableDescription || '',
        (item.primaryKeys || []).join(', '),
        toLightSchemaJson(item),
      ]
      : [
        item.schemaName || '',
        item.tableName,
        item.tableDescription || '',
        (item.primaryKeys || []).join(', '),
        toLightSchemaJson(item),
      ]);
    const jsonCell = row.getCell(multiSource ? 6 : 5);
    jsonCell.alignment = { wrapText: true, vertical: 'top' };
  }

  summary.columns = multiSource
    ? [{ width: 24 }, { width: 18 }, { width: 28 }, { width: 20 }, { width: 24 }, { width: 80 }]
    : [{ width: 18 }, { width: 28 }, { width: 20 }, { width: 24 }, { width: 80 }];
}

async function buildWorkbook({ dataSourceName, schemas, multiSource = false }) {
  const workbook = new ExcelJS.Workbook();
  const catalog = workbook.addWorksheet('目录');
  const header = multiSource
    ? ['数据源', 'Schema', '表名', '列数', '主键', '生成时间']
    : ['表名', '列数', '主键', '生成时间'];
  catalog.addRow(header);
  catalog.getRow(1).font = { bold: true };

  addSummarySheet(workbook, schemas, { multiSource, dataSourceName });

  for (const item of sortSchemas(schemas)) {
    const catalogRow = multiSource
      ? [
        item.dataSourceName || dataSourceName,
        item.schemaName || '',
        item.tableName,
        item.columns.length,
        (item.primaryKeys || []).join(', '),
        item.updatedAt || '',
      ]
      : [item.tableName, item.columns.length, (item.primaryKeys || []).join(', '), item.updatedAt || ''];
    catalog.addRow(catalogRow);

    const sheetBase = multiSource
      ? `${item.dataSourceName || 'ds'}_${item.schemaName || 'public'}_${item.tableName}`
      : item.tableName;
    const ws = workbook.addWorksheet(uniqueSheetName(workbook, sheetBase));
    ws.addRow(['列名', '类型', '可空', '备注', '采样值']);
    ws.getRow(1).font = { bold: true };
    for (const col of item.columns) {
      ws.addRow([
        col.name,
        col.type,
        col.nullable ? 'YES' : 'NO',
        col.description || '',
        (col.sampleValues || []).join(', '),
      ]);
    }
    ws.columns = [
      { width: 20 },
      { width: 18 },
      { width: 12 },
      { width: 40 },
      { width: 48 },
    ];
  }

  catalog.columns = multiSource
    ? [{ width: 24 }, { width: 16 }, { width: 30 }, { width: 10 }, { width: 28 }, { width: 22 }]
    : [{ width: 30 }, { width: 10 }, { width: 28 }, { width: 22 }];

  return workbook.xlsx.writeBuffer();
}

function sortTables(tables) {
  return [...tables].sort((a, b) => {
    const ds = String(a.dataSourceName || '').localeCompare(String(b.dataSourceName || ''));
    if (ds !== 0) return ds;
    const sn = String(a.schemaName || '').localeCompare(String(b.schemaName || ''));
    if (sn !== 0) return sn;
    return String(a.tableName || '').localeCompare(String(b.tableName || ''));
  });
}

function formatCellValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function pickRowValue(row, column) {
  if (row == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, column)) return row[column];
  const lower = String(column).toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lower) return row[key];
  }
  return undefined;
}

function addDataSheet(workbook, table, { multiSource = false } = {}) {
  const sheetBase = multiSource
    ? `${table.dataSourceName || 'ds'}_${table.schemaName || 'public'}_${table.tableName}`
    : table.tableName;
  const ws = workbook.addWorksheet(uniqueSheetName(workbook, sheetBase));

  let rowIndex = 1;
  if (table.tableDescription) {
    ws.addRow([`表备注: ${table.tableDescription}`]);
    ws.getRow(rowIndex).font = { italic: true };
    rowIndex += 1;
  }

  ws.addRow(table.columns);
  ws.getRow(rowIndex).font = { bold: true };
  rowIndex += 1;

  const descriptions = Array.isArray(table.columnDescriptions) ? table.columnDescriptions : [];
  if (descriptions.length === table.columns.length) {
    ws.addRow(descriptions);
    ws.getRow(rowIndex).font = { italic: true, color: { argb: 'FF666666' } };
    rowIndex += 1;
  }

  for (const row of table.rows) {
    ws.addRow(table.columns.map((col) => formatCellValue(pickRowValue(row, col))));
  }
  ws.columns = table.columns.map(() => ({ width: 20 }));
  return ws;
}

async function buildDataWorkbook({ dataSourceName, tables, multiSource = false }) {
  const workbook = new ExcelJS.Workbook();
  const sortedTables = sortTables(tables);

  if (sortedTables.length === 1) {
    addDataSheet(workbook, sortedTables[0], { multiSource });
    return workbook.xlsx.writeBuffer();
  }

  const catalog = workbook.addWorksheet('目录');
  const header = multiSource
    ? ['数据源', 'Schema', '表名', '列数', '行数', '已截断', '导出上限']
    : ['表名', '列数', '行数', '已截断', '导出上限'];
  catalog.addRow(header);
  catalog.getRow(1).font = { bold: true };

  for (const table of sortedTables) {
    catalog.addRow(multiSource
      ? [
        table.dataSourceName || dataSourceName,
        table.schemaName || '',
        table.tableName,
        table.columns.length,
        table.rows.length,
        table.truncated ? '是' : '否',
        table.limit,
      ]
      : [
        table.tableName,
        table.columns.length,
        table.rows.length,
        table.truncated ? '是' : '否',
        table.limit,
      ]);
    addDataSheet(workbook, table, { multiSource });
  }

  catalog.columns = multiSource
    ? [{ width: 24 }, { width: 16 }, { width: 30 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }]
    : [{ width: 30 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }];

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildWorkbook, buildDataWorkbook };
