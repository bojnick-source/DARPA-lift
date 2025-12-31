// ==========================================
// CONFLICT ID (DETERMINISTIC CONTRACT) — A205 (HARDENED)
// FILE: uiux/advanced/conflicts/conflict_id.ts
// ==========================================

import { canonicalJSONStringify } from "../crdt/canonicalize";
import { sha256Hex } from "../crdt/hash";
import type { ConflictKind, ConflictSeverity } from "./conflict_types";

export async function makeConflictId(input: {
  localClientTag: string;
  kind: ConflictKind;
  severity: ConflictSeverity;
  sourcePeer?: string | null;
  // stable correlation fields (do NOT include createdAtMs)
  related?: { opHash?: string; stateHash?: string; auditId?: string; messageId?: string };
  payload?: any;
}): Promise<string> {
  const canon = canonicalJSONStringify({
    localClientTag: input.localClientTag,
    kind: input.kind,
    severity: input.severity,
    sourcePeer: input.sourcePeer ?? null,
    related: input.related ?? null,
    payload: input.payload ?? null,
  });
  const h = await sha256Hex(canon);
  return `c_${h.slice(0, 24)}`;
}
