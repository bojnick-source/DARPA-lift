// ==========================================
// CRDT UPGRADE (Yjs) — A25 (HARDENED)
// Converts Y.Map changes into path/value events for your UI state layer.
// This is intentionally conservative:
//  - only emits direct key changes (no deep diff explosion)
//  - emits absolute paths from the changed map outward
// ==========================================

import * as Y from "yjs";

export type PathEvent =
  | { type: "set"; path: string; value: any }
  | { type: "delete"; path: string };

function join(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

export function observeNestedMap(
  map: Y.Map<any>,
  onEvent: (e: PathEvent) => void,
  basePath = ""
): () => void {
  const childUnsubs = new Map<string, () => void>();

  function ensureChild(key: string, val: any): void {
    if (val instanceof Y.Map) {
      if (!childUnsubs.has(key)) {
        childUnsubs.set(key, observeNestedMap(val, onEvent, join(basePath, key)));
      }
    } else {
      // if non-map replaces a map, unsubscribe old child
      const u = childUnsubs.get(key);
      if (u) {
        u();
        childUnsubs.delete(key);
      }
    }
  }

  // seed children
  map.forEach((v, k) => ensureChild(String(k), v));

  const obs = (evt: Y.YMapEvent<any>) => {
    evt.changes.keys.forEach((change, key) => {
      const k = String(key);
      const p = join(basePath, k);
      if (change.action === "delete") {
        // drop child observers too
        const u = childUnsubs.get(k);
        if (u) {
          u();
          childUnsubs.delete(k);
        }
        onEvent({ type: "delete", path: p });
        return;
      }
      const v = map.get(k);
      ensureChild(k, v);
      onEvent({ type: "set", path: p, value: v instanceof Y.Map ? "(map)" : v });
    });
  };

  map.observe(obs);

  return () => {
    map.unobserve(obs);
    for (const u of childUnsubs.values()) u();
    childUnsubs.clear();
  };
}
