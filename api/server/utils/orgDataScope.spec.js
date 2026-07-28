const {
  deriveDataScope,
  resolveAccessibleOrgCodes,
  collectDescendants,
  normalizeOrgImportRow,
  pickLatestSnapshot,
  buildOrgTree,
} = require('./orgDataScope');

describe('orgDataScope', () => {
  describe('deriveDataScope', () => {
    it('maps brchLv 1-4 correctly', () => {
      expect(deriveDataScope(1)).toBe('ALL');
      expect(deriveDataScope(2)).toBe('SELF_AND_DESCENDANTS');
      expect(deriveDataScope(3)).toBe('SELF_AND_DESCENDANTS');
      expect(deriveDataScope(4)).toBe('SELF');
      expect(deriveDataScope(null)).toBeNull();
      expect(deriveDataScope(9)).toBeNull();
    });
  });

  describe('resolveAccessibleOrgCodes', () => {
    const units = [
      { orgCode: 'FR001', orgName: '全行', parentOrgCode: null, brchLv: 1, enabled: true },
      { orgCode: 'B001', orgName: '分行', parentOrgCode: 'FR001', brchLv: 2, enabled: true },
      { orgCode: 'B00101', orgName: '支行', parentOrgCode: 'B001', brchLv: 4, enabled: true },
      { orgCode: 'B00102', orgName: '禁用网点', parentOrgCode: 'B001', brchLv: 4, enabled: false },
      { orgCode: 'B002', orgName: '另一分行', parentOrgCode: 'FR001', brchLv: 3, enabled: true },
    ];

    it('returns empty when org missing or disabled', () => {
      expect(resolveAccessibleOrgCodes('NOPE', units)).toEqual({ scope: null, orgCodes: [] });
      expect(resolveAccessibleOrgCodes('B00102', units)).toEqual({ scope: null, orgCodes: [] });
    });

    it('ALL returns all enabled orgs', () => {
      const result = resolveAccessibleOrgCodes('FR001', units);
      expect(result.scope).toBe('ALL');
      expect(result.orgCodes.sort()).toEqual(['B001', 'B00101', 'B002', 'FR001'].sort());
    });

    it('SELF returns only self', () => {
      const result = resolveAccessibleOrgCodes('B00101', units);
      expect(result).toEqual({ scope: 'SELF', orgCodes: ['B00101'] });
    });

    it('SELF_AND_DESCENDANTS collects descendants via BFS', () => {
      const result = resolveAccessibleOrgCodes('B001', units);
      expect(result.scope).toBe('SELF_AND_DESCENDANTS');
      expect(result.orgCodes.sort()).toEqual(['B001', 'B00101'].sort());
    });
  });

  describe('collectDescendants', () => {
    it('includes self even without children', () => {
      expect(collectDescendants('X', [{ orgCode: 'X', enabled: true }])).toEqual(['X']);
    });
  });

  describe('normalizeOrgImportRow / pickLatestSnapshot', () => {
    it('accepts DAT column names and root sentinel', () => {
      expect(
        normalizeOrgImportRow({
          data_dt: '20240101',
          brchno: 'A1',
          brchna: '甲',
          brchup: '00000',
          brchlv: '2',
        }),
      ).toEqual({
        orgCode: 'A1',
        orgName: '甲',
        parentOrgCode: null,
        brchLv: 2,
        dataDt: '20240101',
      });
    });

    it('picks max data_dt snapshot', () => {
      const rows = [
        { orgCode: 'A', dataDt: '20240101', orgName: 'old' },
        { orgCode: 'A', dataDt: '20240201', orgName: 'new' },
        { orgCode: 'B', dataDt: '20240201', orgName: 'b' },
        { orgCode: 'C', dataDt: '20240101', orgName: 'skip' },
      ];
      const picked = pickLatestSnapshot(rows);
      expect(picked.map((r) => r.orgCode).sort()).toEqual(['A', 'B']);
      expect(picked.find((r) => r.orgCode === 'A').orgName).toBe('new');
    });
  });

  describe('buildOrgTree', () => {
    it('nests children by parentOrgCode', () => {
      const tree = buildOrgTree([
        { orgCode: 'R', parentOrgCode: null, brchLv: 1 },
        { orgCode: 'C', parentOrgCode: 'R', brchLv: 4 },
      ]);
      expect(tree).toHaveLength(1);
      expect(tree[0].orgCode).toBe('R');
      expect(tree[0].dataScope).toBe('ALL');
      expect(tree[0].children[0].orgCode).toBe('C');
    });
  });
});
