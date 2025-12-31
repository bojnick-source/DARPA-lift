// ==========================================
// AUDIT LOGGING (JSONL + HASH CHAIN) — A34 (HARDENED)
// Canonical audit event schema for NL + CRDT + presence + pipelines.
// ==========================================

export type AuditEventType =
  | "nl.actions"
  | "nl.reject"
  | "crdt.set"
  | "crdt.remote_apply"
  | "presence.update"
  | "pipeline.start"
  | "pipeline.ok"
  | "pipeline.fail"
  | "error";

export interface AuditEvent {
  v: 1;
  sessionId: string;
  clientId: string;

  // Time
  tsWallMs: number;     // Date.now()
  tsMonoMs?: number;    // performance.now() when available

  type: AuditEventType;
  ok: boolean;

  // Optional identifiers
  docId?: string;
  room?: string;
  runId?: string;

  // Payload is JSON-serializable only
  payload?: any;

  // Hash chain fields (tamper-evident log)
  prevHash?: string; // hex
  hash?: string;     // hex
}
