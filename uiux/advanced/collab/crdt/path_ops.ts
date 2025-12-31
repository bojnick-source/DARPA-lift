// ==========================================
// CRDT UPGRADE (Yjs) — A24 (HARDENED)
// Safe path set/get on nested Y.Map.
// Rules:
//  - dot-path only
//  - creates intermediate Y.Maps
//  - refuses empty keys
//  - supports JSON scalars/objects/arrays by storing as plain JS values
// ==========================================

import * as Y from "yjs";

function assertKey(k: string): void {
  if (!k || typeof k !== "string") throw new Error("Invalid path key.");
  if (k.includes("__proto__") || k.includes("constructor") || k.includes("prototype")) {
    throw new Error("Refusing prototype-pollution key.");
  }
}

export function setYByPath(root: Y.Map<any>, path: string, value: any): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("Empty path.");
  for (const p of parts) assertKey(p);

  let cur: Y.Map<any> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    let nxt = cur.get(k);
    if (!(nxt instanceof Y.Map)) {
      nxt = new Y.Map();
      cur.set(k, nxt);
    }
    cur = nxt;
  }
  cur.set(parts[parts.length - 1], value);
}

export function getYByPath(root: Y.Map<any>, path: string): any {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  for (const p of parts) assertKey(p);

  let cur: any = root;
  for (const k of parts) {
    if (!(cur instanceof Y.Map)) return undefined;
    cur = cur.get(k);
  }
  return cur;
}
