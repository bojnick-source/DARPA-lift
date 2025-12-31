// ==========================================
// DETERMINISTIC REPLAY — A35 (HARDENED)
// Minimal deterministic state store: dot-path set + stable JSON snapshot.
// ==========================================

export class ReplayStateStore {
  private root: any = {};

  set(path: string, value: any): void {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) return;
    let cur = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  }

  getRoot(): any {
    return this.root;
  }

  snapshot(): any {
    return structuredClone(this.root);
  }

  stableStringify(): string {
    return stableStringify(this.root);
  }
}

function stableStringify(x: any): string {
  return JSON.stringify(sortRec(x));
}

function sortRec(x: any): any {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortRec);
  const keys = Object.keys(x).sort();
  const out: any = {};
  for (const k of keys) out[k] = sortRec(x[k]);
  return out;
}
