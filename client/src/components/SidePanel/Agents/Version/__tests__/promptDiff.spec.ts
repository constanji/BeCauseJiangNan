import { buildSideBySideDiff } from '../promptDiff';

describe('buildSideBySideDiff', () => {
  it('aligns unchanged lines and pairs adjacent edits', () => {
    const before = ['line1', 'old', 'line3'].join('\n');
    const after = ['line1', 'new', 'line3'].join('\n');
    const rows = buildSideBySideDiff(before, after);
    expect(rows).toEqual([
      { kind: 'equal', left: 'line1', right: 'line1' },
      { kind: 'change', left: 'old', right: 'new' },
      { kind: 'equal', left: 'line3', right: 'line3' },
    ]);
  });

  it('marks pure additions and removals', () => {
    const rows = buildSideBySideDiff('a\nb', 'a\nx\nb');
    expect(rows).toContainEqual({ kind: 'add', left: null, right: 'x' });
  });
});
