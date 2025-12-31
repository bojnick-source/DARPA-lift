// ==========================================
// REAL-TIME SYNC PROTOCOL (MESSAGE SCHEMA) — A179 (HARDENED)
// FILE: uiux/advanced/rt/protocol.ts
// Drives: presence, op broadcast, snapshot sync, reference peer, conflict/mismatch reporting.
// ==========================================

import type { CRDTOpEnvelope, CRDTSnapshotEnvelope, CRDTMeta } from "../crdt/crdt_types";

export type RTMsgKind =
  | "hello"
  | "presence"
  | "op"
  | "snapshot_req"
  | "snapshot_res"
  | "set_reference_peer"
  | "hash_publish"
  | "mismatch"
  | "conflict_notice"
  | "ping"
  | "pong";

export interface RTBase {
  v: 1;
  kind: RTMsgKind;

  // sender
  from: string;

  // intended recipient; null = broadcast
  to: string | null;

  // unique message id (uuid-ish string)
  id: string;

  // local time (ms)
  atMs: number;
}

export interface RTHello extends RTBase {
  kind: "hello";
  meta: CRDTMeta;
  // lightweight capabilities (for forward compatibility)
  caps: {
    provider: "automerge" | "yjs" | "memory";
    supportsOps: boolean;
    supportsSnapshots: boolean;
  };
}

export interface RTPresence extends RTBase {
  kind: "presence";
  status: "online" | "away" | "offline";
  meta: CRDTMeta;
}

export interface RTOp extends RTBase {
  kind: "op";
  op: CRDTOpEnvelope;
}

export interface RTSnapshotReq extends RTBase {
  kind: "snapshot_req";
  // requestId is id of this message; response correlates via inReplyTo
  want: {
    schemaVersion: string | null; // null means "send your current"
    includeOps?: boolean;
    maxOps?: number;
  };
}

export interface RTSnapshotRes extends RTBase {
  kind: "snapshot_res";
  inReplyTo: string;
  snapshot: CRDTSnapshotEnvelope;
  ops?: CRDTOpEnvelope[];
}

export interface RTSetReferencePeer extends RTBase {
  kind: "set_reference_peer";
  peer: string | null;
}

export interface RTHashPublish extends RTBase {
  kind: "hash_publish";
  meta: CRDTMeta; // includes stateHash
}

export interface RTMismatch extends RTBase {
  kind: "mismatch";
  localHash: string;
  remoteHash: string;
  referencePeer: string | null;
  note?: string;
}

export interface RTConflictNotice extends RTBase {
  kind: "conflict_notice";
  // a coarse signal; detailed diffs live in local conflict inbox (optional to send)
  severity: "info" | "warn" | "critical";
  count: number;
  note?: string;
}

export interface RTPing extends RTBase {
  kind: "ping";
  nonce: string;
}

export interface RTPong extends RTBase {
  kind: "pong";
  nonce: string;
}

export type RTMsg =
  | RTHello
  | RTPresence
  | RTOp
  | RTSnapshotReq
  | RTSnapshotRes
  | RTSetReferencePeer
  | RTHashPublish
  | RTMismatch
  | RTConflictNotice
  | RTPing
  | RTPong;

// -----------------------------
// Validation (hardening)
// -----------------------------

const MAX_MSG_BYTES = 512_000; // 512 KB per message cap (adjust)
const MAX_ID_LEN = 96;

export function approxByteLen(x: any): number {
  try {
    return new TextEncoder().encode(JSON.stringify(x)).byteLength;
  } catch {
    // fallback rough
    return JSON.stringify(String(x)).length;
  }
}

export function validateRTMsg(m: any): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== "object") return ["message must be object"];
  if (m.v !== 1) errs.push("unsupported protocol version");
  if (typeof m.kind !== "string") errs.push("kind required");
  if (typeof m.from !== "string" || !m.from) errs.push("from required");
  if (!(m.to === null || typeof m.to === "string")) errs.push("to must be string|null");
  if (typeof m.id !== "string" || !m.id || m.id.length > MAX_ID_LEN) errs.push("id invalid");
  if (!Number.isFinite(Number(m.atMs))) errs.push("atMs invalid");

  // size cap
  const n = approxByteLen(m);
  if (n > MAX_MSG_BYTES) errs.push(`message too large (${n} bytes)`);

  return errs;
}
