// ==========================================
// CONFLICT EVENT TYPES — A82 (HARDENED)
// ==========================================

export type ConflictSeverity = "info" | "warn" | "error";
export type ConflictKind = "hash_mismatch" | "first_divergence" | "transport" | "permission" | "unknown";

export interface ConflictEventDetail {
  message?: string;
  [k: string]: any;
}

export interface ConflictEvent {
  v: number;
  id: string;
  tsMs: number;
  severity: ConflictSeverity;
  kind: ConflictKind;
  room?: string;
  docId?: string;
  peerId?: string;
  detail?: ConflictEventDetail;
}
