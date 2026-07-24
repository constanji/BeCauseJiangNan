const {
  extractKpiDefinition,
  extractOrgInfo,
  preferSortTables,
  stableFileId,
  toPreviewPayload,
  clearExtractCache,
} = require('../TableExtractService');

describe('TableExtractService', () => {
  afterEach(() => {
    clearExtractCache('entity-mock');
  });

  it('preferSortTables 将优选表置顶', () => {
    const sorted = preferSortTables(
      [{ tableName: 'zzz' }, { tableName: 'kpi_result_ctcx' }, { tableName: 'aaa' }],
      'kpi',
    );
    expect(sorted[0].tableName).toBe('kpi_result_ctcx');
  });

  it('stableFileId 按类型稳定', () => {
    expect(stableFileId('kpi', 'ds1')).toBe('kpi_def:ds1');
    expect(stableFileId('org', 'ds1')).toBe('org_info:ds1');
  });

  it('mock 数据源 host 约定触发 fixture', async () => {
    const {
      isKnowledgeExtractMockDataSource,
      shouldUseMock,
      MOCK_DS_HOST,
    } = require('../TableExtractService');
    expect(isKnowledgeExtractMockDataSource({ host: MOCK_DS_HOST })).toBe(true);
    expect(shouldUseMock({}, { host: MOCK_DS_HOST })).toBe(true);
    expect(shouldUseMock({}, { host: 'real-gaussdb.example', database: 'kpi' })).toBe(false);
  });

  it('mock 抽取指标定义并按编号唯一', async () => {
    const result = await extractKpiDefinition({
      dataSource: { type: 'gaussdb', host: 'knowledge-extract.mock' },
      password: '',
      schema: 'kpi',
      table: 'kpi_result_ctcx',
      entityId: 'entity-mock',
      options: {},
    });
    expect(result.mock).toBe(true);
    expect(result.filename).toBe('指标定义信息');
    expect(result.rowCount).toBeGreaterThan(0);
    const codes = result.rows.map((r) => r['指标编号']);
    expect(new Set(codes).size).toBe(codes.length);
    expect(result.rows.some((r) => r['标准名称']?.includes('各项存款余额'))).toBe(true);

    const preview = toPreviewPayload({ ...result, rows: [...result.rows, ...result.rows] }, 2);
    expect(preview.rows).toHaveLength(2);
    expect(preview.previewTruncated).toBe(true);
  });

  it('mock 抽取机构信息含派生列', async () => {
    const result = await extractOrgInfo({
      dataSource: { type: 'gaussdb', host: 'knowledge-extract.mock' },
      password: '',
      schema: 'cmdata',
      table: 'c_par_brch_level',
      entityId: 'entity-mock',
      options: {},
    });
    expect(result.mock).toBe(true);
    expect(result.filename).toBe('机构信息');
    expect(result.headers).toContain('leaf_child_codes');
    const mgr = result.rows.find((r) => r.org_code === 'A0001');
    expect(mgr?.leaf_child_codes).toContain('01001');
  });
});
