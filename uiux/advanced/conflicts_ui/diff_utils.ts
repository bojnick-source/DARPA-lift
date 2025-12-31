// ==========================================
// JSON DIFF UTILS — A231 (HARDENED)
// FILE: uiux/advanced/conflicts_ui/diff_utils.ts
// Deterministic, minimal diff for snapshots: line-based LCS.
// ==========================================

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffLine {
  op: DiffOp;
  left?: string;
  right?: string;
}

export function stablePrettyJSON(x: any): string {
  return JSON.stringify(sortKeys(x), null, 2);
}

function sortKeys(x: any): any {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") {
    const keys = Object.keys(x).sort();
    const o: any = {};
    for (const k of keys) o[k] = sortKeys((x as any)[k]);
    return o;
  }
  return x;
}

// LCS (O(n*m)) for line diff. Keep only for moderate sizes; UI should cap max lines.
export function diffLines(leftText: string, rightText: string, maxLines = 2000): DiffLine[] {
  const L = clampLines(leftText, maxLines);
  const R = clampLines(rightText, maxLines);

  const n = L.length;
  const m = R.length;

  // DP table (lengths)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = L[i] === R[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Reconstruct
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (L[i] === R[j]) {
      out.push({ op: "equal", left: L[i], right: R[j] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "delete", left: L[i] });
      i++;
    } else {
      out.push({ op: "insert", right: R[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "delete", left: L[i++] });
  while (j < m) out.push({ op: "insert", right: R[j++] });

  return out;
}

function clampLines(text: string, maxLines: number): string[] {
  const lines = (text ?? "").split("\n");
  if (lines.length <= maxLines) return lines;
  const head = lines.slice(0, Math.floor(maxLines * 0.7));
  const tail = lines.slice(lines.length - Math.floor(maxLines * 0.3));
  return [
    ...head,
    `/* …clamped ${lines.length - maxLines} lines… */`,
    ...tail,
  ];
}
