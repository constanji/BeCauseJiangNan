const {
  computeTextMatchScore,
  computeSubsequenceCompactness,
  applyVectorColumnWeight,
  mergeSearchResults,
  parseColumnList,
  buildFullRow,
} = require('../ExcelColumnSearchUtils');

describe('ExcelColumnSearchUtils', () => {
  it('parseColumnList 支持中英文逗号', () => {
    expect(parseColumnList('org_code，name,region_org_code')).toEqual([
      'org_code',
      'name',
      'region_org_code',
    ]);
  });

  it('主列精确命中分数高于非主列包含命中', () => {
    const primaryExact = computeTextMatchScore({
      query: 'A0000',
      cellValue: 'A0000',
      isPrimaryColumn: true,
      hasPrimaryConfig: true,
    });
    const nonPrimaryContains = computeTextMatchScore({
      query: 'A0000',
      cellValue: 'A0000, A0001',
      isPrimaryColumn: false,
      hasPrimaryConfig: true,
    });
    expect(primaryExact).toBe(1.0);
    expect(nonPrimaryContains).toBeLessThan(0.8);
  });

  it('buildFullRow 始终返回所有列，不因排除列而删减', () => {
    const headers = ['org_code', 'name', 'region_org_code'];
    const row = ['A0000', '武进支行', 'A0000,A0001'];
    const fullRow = buildFullRow(headers, row);
    expect(fullRow).toBe('org_code: A0000 | name: 武进支行 | region_org_code: A0000,A0001');
    expect(fullRow).toContain('region_org_code');
  });

  it('有主列配置时仅返回主列命中', () => {
    const results = mergeSearchResults({
      topK: 5,
      hasPrimaryConfig: true,
      textRows: [
        {
          score: 0.55,
          cellValue: 'A0000, A0001',
          columnName: 'region_org_code',
          fullRow: 'x',
          filename: 'a.xlsx',
          rowIndex: 1,
          sheetName: 'Sheet1',
          isPrimaryColumn: false,
        },
        {
          score: 1.0,
          cellValue: 'A0000',
          columnName: 'org_code',
          fullRow: 'y',
          filename: 'a.xlsx',
          rowIndex: 2,
          sheetName: 'Sheet1',
          isPrimaryColumn: true,
        },
      ],
      vectorRows: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0].columnName).toBe('org_code');
  });

  it('向量相似度即使接近满分，也不能超过主列文本精确匹配的分数上限', () => {
    // 短编码类主列（org_code）嵌入距离很近，向量相似度可能对无关编码也接近 1.0，
    // applyVectorColumnWeight 必须把它压到严格低于任何文本命中档位。
    const nearPerfectVectorSimilarity = 0.999;
    const weighted = applyVectorColumnWeight(nearPerfectVectorSimilarity, true, true);
    expect(weighted).toBeLessThan(0.93); // 低于主列文本「包含」命中档位
    expect(weighted).toBeLessThan(1.0); // 严格低于主列文本「精确」命中档位
  });

  it('回归：无关编码的高向量相似度不应把真正的精确匹配挤到后面', () => {
    // 复现实际问题：搜索 "A0001"，FR001/A8000/A0000 因短编码嵌入距离很近命中高相似度的
    // 向量结果，A0001 的真实精确文本命中反而因为 tie-break 按行号排在最后。
    const vectorScoreForUnrelatedCodes = applyVectorColumnWeight(0.999, true, true);

    const results = mergeSearchResults({
      topK: 10,
      hasPrimaryConfig: true,
      textRows: [
        {
          score: 1.0,
          cellValue: 'A0001',
          columnName: 'org_code',
          fullRow: 'org_code: A0001 | org_name: 常州分行营业部',
          filename: 'org_master.xlsx',
          rowIndex: 10, // 真实匹配行号靠后（层级更深）
          sheetName: 'Sheet1',
          isPrimaryColumn: true,
          isExactMatch: true,
        },
      ],
      vectorRows: [
        {
          score: vectorScoreForUnrelatedCodes,
          cellValue: 'FR001',
          columnName: 'org_code',
          fullRow: 'org_code: FR001 | org_name: 总行',
          filename: 'org_master.xlsx',
          rowIndex: 0,
          sheetName: 'Sheet1',
          isPrimaryColumn: true,
          isExactMatch: false,
        },
        {
          score: vectorScoreForUnrelatedCodes,
          cellValue: 'A8000',
          columnName: 'org_code',
          fullRow: 'org_code: A8000 | org_name: 总行营业部',
          filename: 'org_master.xlsx',
          rowIndex: 1,
          sheetName: 'Sheet1',
          isPrimaryColumn: true,
          isExactMatch: false,
        },
        {
          score: vectorScoreForUnrelatedCodes,
          cellValue: 'A0000',
          columnName: 'org_code',
          fullRow: 'org_code: A0000 | org_name: 常州分行',
          filename: 'org_master.xlsx',
          rowIndex: 2,
          sheetName: 'Sheet1',
          isPrimaryColumn: true,
          isExactMatch: false,
        },
      ],
    });

    expect(results[0].cellValue).toBe('A0001');
    expect(results[0].isExactMatch).toBe(true);
  });

  it('computeSubsequenceCompactness 识别中间插字的有序子序列', () => {
    // "溧阳市支行" 在"市"前后插入了字符，但"溧阳支行"四个字仍按顺序出现
    expect(computeSubsequenceCompactness('溧阳支行', '溧阳市支行')).toBeCloseTo(0.8);
    // "洛阳支行" 完全不包含"溧"，不构成子序列
    expect(computeSubsequenceCompactness('溧阳支行', '洛阳支行')).toBeNull();
  });

  it('回归："溧阳支行"应模糊命中"溧阳市支行"，且分数高于向量匹配上限但低于字面包含命中', () => {
    // 复现实际问题：ILIKE '%溧阳支行%' 匹配不到"溧阳市支行"（中间插了"市"字），
    // 此前会完全跳过该行，只能靠不可靠的向量语义匹配命中"洛阳支行"等无关分支。
    const fuzzyScore = computeTextMatchScore({
      query: '溧阳支行',
      cellValue: '溧阳市支行',
      isPrimaryColumn: true,
      hasPrimaryConfig: true,
    });
    expect(fuzzyScore).not.toBeNull();
    expect(fuzzyScore).toBeGreaterThan(0.6); // 高于向量主列上限
    expect(fuzzyScore).toBeLessThan(0.93); // 低于主列字面包含命中

    // "洛阳支行" 不应命中任何文本档位（完全不构成子序列）
    const unrelatedScore = computeTextMatchScore({
      query: '溧阳支行',
      cellValue: '洛阳支行',
      isPrimaryColumn: true,
      hasPrimaryConfig: true,
    });
    expect(unrelatedScore).toBeNull();

    // 合并排序后，模糊命中的"溧阳市支行"应排在向量命中的"洛阳支行"之前
    const vectorScoreForUnrelated = applyVectorColumnWeight(0.9, true, true);
    const results = mergeSearchResults({
      topK: 5,
      hasPrimaryConfig: true,
      textRows: [
        {
          score: fuzzyScore,
          cellValue: '溧阳市支行',
          columnName: 'org_name',
          fullRow: 'org_code: A0009 | org_name: 溧阳市支行',
          filename: 'org_master.xlsx',
          rowIndex: 5,
          sheetName: 'Sheet1',
          isPrimaryColumn: true,
          isExactMatch: false,
        },
      ],
      vectorRows: [
        {
          score: vectorScoreForUnrelated,
          cellValue: '洛阳支行',
          columnName: 'org_name',
          fullRow: 'org_code: 01052 | org_name: 洛阳支行',
          filename: 'org_master.xlsx',
          rowIndex: 20,
          sheetName: 'Sheet1',
          isPrimaryColumn: true,
          isExactMatch: false,
        },
      ],
    });

    expect(results[0].cellValue).toBe('溧阳市支行');
  });
});
