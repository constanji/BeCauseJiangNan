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

async function buildWorkbook({ dataSourceName, schemas, multiSource = false }) {
  const workbook = new ExcelJS.Workbook();
  const catalog = workbook.addWorksheet('目录');
  const header = multiSource
    ? ['数据源', 'Schema', '表名', '列数', '主键', '生成时间']
    : ['表名', '列数', '主键', '生成时间'];
  catalog.addRow(header);
  catalog.getRow(1).font = { bold: true };

  for (const item of schemas) {
    const catalogRow = multiSource
      ? [
        item.dataSourceName || dataSourceName,
        item.schemaName || '',
        item.tableName,
        item.columns.length,
        item.primaryKeys.join(', '),
        item.updatedAt || '',
      ]
      : [item.tableName, item.columns.length, item.primaryKeys.join(', '), item.updatedAt || ''];
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

module.exports = { buildWorkbook };
