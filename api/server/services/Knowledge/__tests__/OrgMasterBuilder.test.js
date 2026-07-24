const {
  buildOrgMasterFromBrchRows,
  ORG_MASTER_HEADERS,
  inferOrgLevel,
} = require('../OrgMasterBuilder');

describe('OrgMasterBuilder', () => {
  it('inferOrgLevel：brchlv 定级别，号段定名称', () => {
    expect(inferOrgLevel('A0001', 3)).toEqual({
      org_level: 3,
      org_level_name: '管理行',
    });
    expect(inferOrgLevel('A0000', 2)).toEqual({
      org_level: 2,
      org_level_name: '区域分行',
    });
  });

  it('构建小树：管理行有 leaf_child_codes，且 headers 对齐 org_master', () => {
    const built = buildOrgMasterFromBrchRows([
      { brchno: '00000', brchna: '银行', brchup: '', brchlv: 0 },
      { brchno: 'FR001', brchna: '法人', brchup: '00000', brchlv: 1 },
      { brchno: 'A0000', brchna: '区域', brchup: 'FR001', brchlv: 2 },
      { brchno: 'A0001', brchna: '管理行', brchup: 'A0000', brchlv: 3 },
      { brchno: '01001', brchna: '网点甲', brchup: 'A0001', brchlv: 4 },
      { brchno: '01002', brchna: '网点乙', brchup: 'A0001', brchlv: 4 },
    ]);

    expect(built.headers).toEqual(ORG_MASTER_HEADERS);
    expect(built.rowCount).toBe(6);

    const mgr = built.rows.find((r) => r.org_code === 'A0001');
    expect(mgr).toBeTruthy();
    expect(mgr.leaf_child_codes).toBe('01001,01002');
    expect(mgr.leaf_child_orgs).toBe('01001 网点甲；01002 网点乙');
    expect(mgr.kpi_query_self).toBe("org_code='A0001'");
    expect(mgr.kpi_query_drilldown).toContain("'01001'");
    expect(mgr.parent_org_name).toBe('区域');
    expect(mgr.region_org_code).toBe('A0000');
    expect(mgr.org_level_name).toBe('管理行'); // 号段推断优先于通用 brchlv 文案

    const region = built.rows.find((r) => r.org_code === 'A0000');
    expect(region.org_level_name).toBe('区域分行');
    expect(region.leaf_child_orgs).toBe('A0001 管理行');

    const leaf = built.rows.find((r) => r.org_code === '01001');
    expect(leaf.leaf_child_codes).toBe('');
    expect(leaf.same_level_codes).toContain('01001');
    expect(leaf.same_level_codes).toContain('01002');
  });

  it('补充列写入 scope_note / parent_org_name', () => {
    const built = buildOrgMasterFromBrchRows([
      {
        brchno: '01001',
        brchna: '湖塘网点',
        brchup: 'A0001',
        brchlv: 4,
        brchup_name: '武进支行',
        brsmna: '湖塘',
        cityno_name: '常州分行',
        corpno: 'FR001',
      },
    ]);
    const row = built.rows[0];
    expect(row.parent_org_name).toBe('武进支行');
    expect(row.scope_note).toContain('分行:常州分行');
    expect(row.scope_note).toContain('简称:湖塘');
    expect(row.notes).toContain('父节点缺失');
  });

  it('按 brchno 输入去重由调用方负责；缺父节点写入 notes', () => {
    const built = buildOrgMasterFromBrchRows([
      { brchno: '01001', brchna: '网点', brchup: 'MISSING', brchlv: 4 },
    ]);
    expect(built.rows[0].parent_org_code).toBe('');
    expect(built.rows[0].notes).toContain('父节点缺失');
  });
});
