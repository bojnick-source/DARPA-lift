// ==========================================
// DETERMINISTIC REPLAY — A35 (HARDENED)
// Verifies JSONL audit log hash chain (SHA-256) and returns first failure (if any).
// ==========================================

import type { AuditEvent } from "../audit_types";
import { sha256Hex } from "../hash";

function canonicalLineForHash(e: AuditEvent, seq: number): string {
  return JSON.stringify({
    seq,
    v: e.v,
    sessionId: e.sessionId,
    clientId: e.clientId,
    tsWallMs: e.tsWallMs,
    tsMonoMs: e.tsMonoMs ?? null,
    type: e.type,
    ok: e.ok,
    docId: e.docId ?? null,
    room: e.room ?? null,
    runId: e.runId ?? null,
    prevHash: e.prevHash ?? null,
    payload: e.payload ?? null,
  });
}

export interface HashChainResult {
  ok: boolean;
  checked: number;
  firstBadIndex?: number;
  reason?: string;
}

export async function verifyHashChain(events: AuditEvent[]): Promise<HashChainResult> {
  let prev = "";
  for (let i = 0; i < events.length; i++) {
    const e = events[i];

    // If hashing wasn't enabled, skip verification
    if (!e.hash) continue;

    if (e.prevHash && e.prevHash !== prev) {
      return { ok: false, checked: i + 1, firstBadIndex: i, reason: "prevHash mismatch" };
    }

    const canon = canonicalLineForHash({ ...e, hash: undefined }, i);
    const h = await sha256Hex(canon);
    if (h && e.hash !== h) {
      return { ok: false, checked: i + 1, firstBadIndex: i, reason: "hash mismatch" };
    }

    prev = e.hash ?? prev;
  }

  return { ok: true, checked: events.length };
}
