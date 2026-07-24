jest.mock('~/server/services/RAG/VectorDBService', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    getPool: () => mockPool,
  }));
});

jest.mock('~/server/services/RAG/EmbeddingService', () => {
  return jest.fn().mockImplementation(() => ({
    embedText: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  }));
});

const mockPool = {
  query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
};

const ExcelCellVectorizationService = require('../../Files/ExcelCellVectorizationService');

describe('ExcelCellVectorizationService.vectorizeFromRows', () => {
  beforeEach(() => {
    mockPool.query.mockClear();
  });

  it('写入 excel_cell metadata 并使用稳定 fileId 覆盖', async () => {
    const svc = new ExcelCellVectorizationService();
    const result = await svc.vectorizeFromRows({
      entityId: 'ds-1',
      userId: 'u-1',
      fileId: 'kpi_def:ds-1',
      filename: '指标定义信息',
      headers: ['指标编号', '标准名称'],
      rows: [
        { 指标编号: 'BM1', 标准名称: '存款余额' },
        { 指标编号: 'BM2', 标准名称: '' },
      ],
      primaryColumns: ['指标编号', '标准名称'],
      excludedColumns: [],
      sheetName: '指标定义',
      replaceExisting: true,
    });

    expect(result.fileId).toBe('kpi_def:ds-1');
    expect(result.rowCount).toBe(2);
    expect(result.cellCount).toBe(3); // BM2 标准名称为空跳过

    // delete + cell inserts + file_config
    expect(mockPool.query).toHaveBeenCalled();
    const insertCalls = mockPool.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO file_vectors'),
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(3);

    const cellMeta = JSON.parse(insertCalls[0][1][6]);
    expect(cellMeta.source).toBe('excel_cell');
    expect(cellMeta.filename).toBe('指标定义信息');
    expect(cellMeta.full_row).toContain('指标编号: BM1');
    expect(cellMeta.is_primary_column).toBe(true);
  });
});
