export type DiffSideRow = {
  kind: 'equal' | 'remove' | 'add' | 'change';
  left: string | null;
  right: string | null;
};

/**
 * Line-level side-by-side diff for long prompt text.
 * Uses LCS so common blocks stay aligned; only changed hunks stand out.
 */
export function buildSideBySideDiff(before: string, after: string): DiffSideRow[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length === 0 && b.length === 0) {
    return [];
  }

  const lcs = computeLcsTable(a, b);
  const ops = backtrackOps(a, b, lcs);
  const rows: DiffSideRow[] = [];

  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'equal') {
      rows.push({ kind: 'equal', left: op.value, right: op.value });
      i += 1;
      continue;
    }

    // Pair consecutive remove+add as a single "change" row when possible
    if (op.type === 'remove' && ops[i + 1]?.type === 'add') {
      rows.push({
        kind: 'change',
        left: op.value,
        right: ops[i + 1].value,
      });
      i += 2;
      continue;
    }

    if (op.type === 'remove') {
      rows.push({ kind: 'remove', left: op.value, right: null });
    } else {
      rows.push({ kind: 'add', left: null, right: op.value });
    }
    i += 1;
  }

  return rows;
}

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.replace(/\r\n/g, '\n').split('\n');
}

type DiffOp = { type: 'equal' | 'remove' | 'add'; value: string };

function computeLcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function backtrackOps(a: string[], b: string[], dp: number[][]): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'equal', value: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', value: b[j - 1] });
      j -= 1;
    } else if (i > 0) {
      ops.push({ type: 'remove', value: a[i - 1] });
      i -= 1;
    }
  }
  ops.reverse();
  return ops;
}
