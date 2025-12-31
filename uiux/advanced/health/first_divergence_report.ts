// ==========================================
// FIRST DIVERGENCE REPORT — A93 (HARDENED)
// Deep-diff local vs reference snapshots with bounded output.
// ==========================================

import { sha256Hex } from "../audit/hash";
import type { AuditLogger } from "../audit/audit_logger";

export interface DiffItem {
  path: string;
  local: any;
  ref: any;
  kind: "type" | "value" | "missing_local" | "missing_ref";
}

export interface DivergenceReport {
  ok: boolean; // ok === true means snapshots match
  localHash: string;
  refHash: string;
  firstMismatchPath?: string;
  diffs: DiffItem[];
  note?: string;
}

export interface DivergenceReportOptions {
  maxDiffs: number;       // default 50
  maxDepth: number;       // default 12
  maxValueChars: number;  // default 240
}

const DEFAULTS: DivergenceReportOptions = {
  maxDiffs: 50,
  maxDepth: 12,
  maxValueChars: 240,
};

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

function isObj(x: any): boolean {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function clipValue(x: any, maxChars: number): any {
  if (x === null || x === undefined) return x;
  if (typeof x === "string") return x.length > maxChars ? x.slice(0, maxChars) + "…" : x;
  if (typeof x === "number" || typeof x === "boolean") return x;
  // for objects/arrays, print compact JSON
  let s = "";
  try { s = JSON.stringify(x); } catch { s = String(x); }
  if (s.length > maxChars) s = s.slice(0, maxChars) + "…";
  return s;
}

function pathJoin(base: string, key: string | number): string {
  if (base === "") return String(key);
  if (typeof key === "number") return `${base}[${key}]`;
  // dot safe
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) return `${base}.${key}`;
  return `${base}["${String(key).replaceAll('"', '\\"')}"]`;
}

function pushDiff(out: DiffItem[], item: DiffItem, opts: DivergenceReportOptions): void {
  if (out.length >= opts.maxDiffs) return;
  out.push({
    ...item,
    local: clipValue(item.local, opts.maxValueChars),
    ref: clipValue(item.ref, opts.maxValueChars),
  });
}

function deepDiff(
  local: any,
  ref: any,
  basePath: string,
  depth: number,
  out: DiffItem[],
  first: { path?: string },
  opts: DivergenceReportOptions
): void {
  if (out.length >= opts.maxDiffs) return;
  if (depth > opts.maxDepth) return;

  // strict equality fast path (works for primitives and identical refs)
  if (local === ref) return;

  const tL = Array.isArray(local) ? "array" : typeof local;
  const tR = Array.isArray(ref) ? "array" : typeof ref;

  if (tL !== tR) {
    if (!first.path) first.path = basePath || "(root)";
    pushDiff(out, { path: basePath || "(root)", local, ref, kind: "type" }, opts);
    return;
  }

  // primitives
  if (local === null || ref === null || typeof local !== "object") {
    if (!first.path) first.path = basePath || "(root)";
    pushDiff(out, { path: basePath || "(root)", local, ref, kind: "value" }, opts);
    return;
  }

  // arrays
  if (Array.isArray(local) && Array.isArray(ref)) {
    const n = Math.max(local.length, ref.length);
    for (let i = 0; i < n; i++) {
      if (out.length >= opts.maxDiffs) return;

      if (i >= local.length) {
        const p = pathJoin(basePath, i);
        if (!first.path) first.path = p;
        pushDiff(out, { path: p, local: undefined, ref: ref[i], kind: "missing_local" }, opts);
        continue;
      }
      if (i >= ref.length) {
        const p = pathJoin(basePath, i);
        if (!first.path) first.path = p;
        pushDiff(out, { path: p, local: local[i], ref: undefined, kind: "missing_ref" }, opts);
        continue;
      }
      deepDiff(local[i], ref[i], pathJoin(basePath, i), depth + 1, out, first, opts);
      if (first.path && out.length >= opts.maxDiffs) return;
    }
    return;
  }

  // objects
  if (isObj(local) && isObj(ref)) {
    const keys = new Set<string>([...Object.keys(local), ...Object.keys(ref)]);
    const sorted = Array.from(keys).sort();
    for (const k of sorted) {
      if (out.length >= opts.maxDiffs) return;

      const hasL = Object.prototype.hasOwnProperty.call(local, k);
      const hasR = Object.prototype.hasOwnProperty.call(ref, k);

      const p = pathJoin(basePath, k);

      if (!hasL && hasR) {
        if (!first.path) first.path = p;
        pushDiff(out, { path: p, local: undefined, ref: (ref as any)[k], kind: "missing_local" }, opts);
        continue;
      }
      if (hasL && !hasR) {
        if (!first.path) first.path = p;
        pushDiff(out, { path: p, local: (local as any)[k], ref: undefined, kind: "missing_ref" }, opts);
        continue;
      }

      deepDiff((local as any)[k], (ref as any)[k], p, depth + 1, out, first, opts);
    }
  }
}

export async function firstDivergenceReport(opts: {
  local: any;
  ref: any;
  options?: Partial<DivergenceReportOptions>;
  audit?: AuditLogger;
  context?: { room?: string; docId?: string; peer?: string };
}): Promise<DivergenceReport> {
  const o: DivergenceReportOptions = { ...DEFAULTS, ...(opts.options ?? {}) };

  const localStable = stableStringify(opts.local ?? {});
  const refStable = stableStringify(opts.ref ?? {});

  const [localHash, refHash] = await Promise.all([sha256Hex(localStable), sha256Hex(refStable)]);

  const diffs: DiffItem[] = [];
  const first: { path?: string } = {};

  deepDiff(opts.local ?? {}, opts.ref ?? {}, "", 0, diffs, first, o);

  const ok = diffs.length === 0;

  const report: DivergenceReport = {
    ok,
    localHash,
    refHash,
    firstMismatchPath: first.path,
    diffs,
  };

  await opts.audit?.log("crdt.remote_apply", true, {
    type: "first_divergence_report",
    ok,
    room: opts.context?.room ?? null,
    docId: opts.context?.docId ?? null,
    peer: opts.context?.peer ?? null,
    localHash,
    refHash,
    firstMismatchPath: first.path ?? null,
    diffsCount: diffs.length,
    sample: diffs.slice(0, 5),
  });

  return report;
}
