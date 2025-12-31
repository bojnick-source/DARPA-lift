// ==========================================
// CONFLICT TYPES — A204 (HARDENED)
// FILE: uiux/advanced/conflicts/conflict_types.ts
// Conflict inbox is the safety rail for collaboration drift + unsafe actions.
// ==========================================

export type ConflictSeverity = "info" | "warn" | "critical";

export type ConflictKind =
  | "hash_mismatch"         // reference peer hash mismatch
  | "op_apply_failed"       // CRDT op rejected / failed
  | "snapshot_apply_failed" // snapshot rejected / failed
  | "schema_mismatch"       // peer schema version mismatch
  | "policy_violation"      // robustness gate change, permission issue, etc
  | "transport_error"       // ws errors, send failures
  | "unknown";

export type ConflictStatus = "open" | "acked" | "resolved" | "ignored";

export interface ConflictItem {
  v: 1;

  id: string;          // deterministic-ish id (see conflict_id.ts)
  createdAtMs: number;
  updatedAtMs: number;

  severity: ConflictSeverity;
  kind: ConflictKind;
  status: ConflictStatus;

  // Who triggered it (peer) and who recorded it (local)
  sourcePeer?: string | null;
  localClientTag: string;

  // Human readable
  title: string;
  detail?: string;

  // Machine payload for diagnostics (MUST be JSON serializable)
  payload?: any;

  // Optional linking for UI and correlation
  related?: {
    auditId?: string;
    messageId?: string;
    opHash?: string;
    stateHash?: string;
  };

  // Optional: suggestion for remediation
  recommendedAction?: "request_snapshot" | "set_reference_peer" | "inspect_op" | "ignore" | "none";
}

export interface ConflictPolicy {
  v: 1;

  // keep at most N conflicts in memory
  maxItems: number;

  // auto-ack "info" and/or some kinds if safe
  autoAck: {
    enabled: boolean;
    severities: ConflictSeverity[]; // e.g. ["info"]
    kinds: ConflictKind[];          // e.g. ["transport_error"]
  };

  // purge resolved/ignored after TTL
  purge: {
    enabled: boolean;
    resolvedTTLms: number;
    ignoredTTLms: number;
  };
}

export interface ConflictQuery {
  status?: ConflictStatus | "any";
  severity?: ConflictSeverity | "any";
  kind?: ConflictKind | "any";
  text?: string;
  limit?: number;
}

export interface ConflictCounts {
  open: number;
  acked: number;
  resolved: number;
  ignored: number;

  criticalOpen: number;
}
