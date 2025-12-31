// ==========================================
// CONFLICT UI TYPES — A230 (HARDENED)
// FILE: uiux/advanced/conflicts_ui/conflict_ui_types.ts
// UI-facing types + adapter so the UI does not depend on internal store shape.
// ==========================================

export type ConflictSeverity = "info" | "warn" | "critical";

export type ConflictResolution =
  | "acked"
  | "resolved_keep_local"
  | "resolved_accept_remote"
  | "resolved_manual_merge"
  | "ignored"
  | "snapshot_requested";

export interface ConflictRecord {
  id: string;
  createdAtMs: number;

  severity: ConflictSeverity;
  kind: string;

  title: string;
  detail?: string;

  sourcePeer?: string;
  payload?: any;

  // recommended UI action hint (optional)
  recommendedAction?: "request_snapshot" | "manual_merge" | "accept_remote" | "keep_local";

  // status
  status: "open" | "acked" | "resolved" | "ignored";
  resolution?: ConflictResolution;
  resolvedAtMs?: number;
  note?: string;
}

export interface ConflictCounts {
  open: number;
  acked: number;
  resolved: number;
  ignored: number;
  criticalOpen: number;
}

export interface ConflictUIAdapter {
  // data
  list: () => ConflictRecord[];
  get: (id: string) => ConflictRecord | undefined;
  counts: () => ConflictCounts;

  // actions
  ack: (id: string, note?: string) => Promise<void>;
  ignore: (id: string, note?: string) => Promise<void>;

  // “hard” resolution actions
  keepLocal?: (id: string, note?: string) => Promise<void>;
  acceptRemote?: (id: string, note?: string) => Promise<void>;
  manualMerge?: (id: string, merged?: any, note?: string) => Promise<void>;

  // collaboration actions
  requestSnapshot?: (peer: string, reason?: string) => Promise<void>;
}

export interface AuditLogger {
  log: (category: string, action: string, ok: boolean, payload?: any) => Promise<{ id?: string } | void>;
}
