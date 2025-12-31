// ==========================================
// SNAPSHOT HELPERS — A115 (HARDENED)
// Deterministic snapshot + hash helpers for Yjs maps.
// ==========================================

import type * as Y from "yjs";
import { sha256Hex } from "../audit/hash";

function sortRec(x: any): any {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortRec);
  const keys = Object.keys(x).sort();
  const out: any = {};
  for (const k of keys) out[k] = sortRec(x[k]);
  return out;
}

function stableStringify(x: any): string {
  return JSON.stringify(sortRec(x));
}

export function ymapToJSON(map: Y.Map<any>): any {
  const j = map.toJSON();
  return structuredClone(j);
}

export async function hashSnapshot(snapshot: any): Promise<string> {
  const stable = stableStringify(snapshot ?? {});
  return sha256Hex(stable);
}

// meta helpers
export function getReferenceClientTag(meta: any): string | null {
  return meta?.reference?.clientTag ?? null;
}

export function getReferenceHashFromMeta(meta: any): string | null {
  const ref = getReferenceClientTag(meta);
  if (!ref) return null;
  return meta?.hashes?.[ref]?.hash ?? null;
}

export function getLocalHashFromMeta(meta: any, clientTag: string): string | null {
  return meta?.hashes?.[clientTag]?.hash ?? null;
}
