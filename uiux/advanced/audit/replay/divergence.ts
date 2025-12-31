// ==========================================
// DIVERGENCE DETECTOR — A36 (HARDENED)
// Compares two replay end-states and finds first difference + mismatch stats.
// Deterministic: uses stable-key traversal order.
// ==========================================

import { ReplayStateStore } from "./state_store";

export interface DiffStats {
  totalPathsCompared: number;
  mismatchedPaths: number;
  addedPaths: number;
  removedPaths: number;
  firstMismatch?: {
    path: string;
    a: any;
    b: any;
    kind: "value" | "type" | "missing_in_a" | "missing_in_b";
  };
}

export function compareStores(a: ReplayStateStore, b: ReplayStateStore): DiffStats {
  return compareSnapshots(a.snapshot(), b.snapshot());
}

export function compareSnapshots(aRoot: any, bRoot: any): DiffStats {
  const aMap = flatten(aRoot);
  const bMap = flatten(bRoot);

  const allPaths = Array.from(new Set([...aMap.keys(), ...bMap.keys()])).sort();

  let total = 0;
  let mismatched = 0;
  let added = 0;
  let removed = 0;

  let firstMismatch: DiffStats["firstMismatch"] = undefined;

  for (const path of allPaths) {
    total++;

    const aHas = aMap.has(path);
    const bHas = bMap.has(path);

    if (!aHas && bHas) {
      added++;
      mismatched++;
      if (!firstMismatch) {
        firstMismatch = { path, a: undefined, b: bMap.get(path), kind: "missing_in_a" };
      }
      continue;
    }

    if (aHas && !bHas) {
      removed++;
      mismatched++;
      if (!firstMismatch) {
        firstMismatch = { path, a: aMap.get(path), b: undefined, kind: "missing_in_b" };
      }
      continue;
    }

    const av = aMap.get(path);
    const bv = bMap.get(path);

    const ak = typeTag(av);
    const bk = typeTag(bv);

    if (ak !== bk) {
      mismatched++;
      if (!firstMismatch) firstMismatch = { path, a: av, b: bv, kind: "type" };
      continue;
    }

    if (!deepEqual(av, bv)) {
      mismatched++;
      if (!firstMismatch) firstMismatch = { path, a: av, b: bv, kind: "value" };
      continue;
    }
  }

  return {
    totalPathsCompared: total,
    mismatchedPaths: mismatched,
    addedPaths: added,
    removedPaths: removed,
    firstMismatch,
  };
}

function flatten(root: any): Map<string, any> {
  const out = new Map<string, any>();
  walk(root, "", out);
  return out;
}

function walk(x: any, base: string, out: Map<string, any>) {
  if (x === null || typeof x !== "object") {
    out.set(base || "(root)", x);
    return;
  }

  if (Array.isArray(x)) {
    // Arrays: index keys keep deterministic ordering
    if (x.length === 0) out.set(base || "(root)", []);
    for (let i = 0; i < x.length; i++) {
      const p = base ? `${base}[${i}]` : `[${i}]`;
      walk(x[i], p, out);
    }
    return;
  }

  const keys = Object.keys(x).sort();
  if (keys.length === 0) out.set(base || "(root)", {});
  for (const k of keys) {
    const p = base ? `${base}.${k}` : k;
    walk(x[k], p, out);
  }
}

function typeTag(v: any): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  const ta = typeTag(a);
  const tb = typeTag(b);
  if (ta !== tb) return false;

  if (ta === "array") {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }

  if (ta === "object") {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }

  // number/string/boolean/null/undefined
  return false;
}
