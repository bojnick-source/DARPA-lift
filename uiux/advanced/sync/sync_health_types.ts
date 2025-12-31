// ==========================================
// SYNC HEALTH TYPES — A212 (HARDENED)
// FILE: uiux/advanced/sync/sync_health_types.ts
// Dashboard contracts for drift, determinism, peer health, and robustness gate status.
// ==========================================

export type HealthSeverity = "ok" | "warn" | "critical";

export interface PeerHash {
  clientTag: string;
  hash: string;
  schemaVersion: string;
  publishedMs: number;
}

export interface MismatchEvent {
  id: string;
  atMs: number;
  localHash: string;
  remoteHash: string;
  referencePeer: string | null;
  note?: string;
}

export interface DeterminismCheck {
  v: 1;
  ok: boolean;
  checkedAtMs: number;

  // e.g. "audit-log", "replay", "crdt"
  source: string;

  // optional counts
  total?: number;
  mismatches?: number;
  firstMismatch?: any;
}

export interface RobustnessGate {
  name: string;
  // threshold meaning depends on comparator
  threshold: number;
  comparator: "<=" | "<" | ">=" | ">";
  // quantile label (if applicable)
  quantile?: "q10" | "q50" | "q90" | "cvar95" | "cvar99" | "raw";
  units?: string;
  description?: string;
}

export interface RobustnessGateEval {
  gate: RobustnessGate;
  // current measured/estimated value (may be undefined if not available yet)
  value?: number;
  ok: boolean;
  severity: HealthSeverity;
  note?: string;
}

export interface GateBundle {
  v: 1;
  // policy-configured gates (not hard-coded)
  gates: RobustnessGate[];
  // optional last evaluation results
  evals?: RobustnessGateEval[];
  evaluatedAtMs?: number;
}

export interface SyncHealthSnapshot {
  v: 1;
  atMs: number;

  // collaboration state
  referencePeer: string | null;
  peers: PeerHash[];

  // mismatch events (hash drift)
  mismatches: MismatchEvent[];

  // conflicts (from ConflictStore.counts())
  conflictCounts: {
    open: number;
    acked: number;
    resolved: number;
    ignored: number;
    criticalOpen: number;
  };

  // determinism (audit or replay checks)
  determinism?: DeterminismCheck;

  // robustness gates (policy + last eval)
  gates?: GateBundle;

  // derived severity for quick UI
  severity: HealthSeverity;

  // human-readable top issue
  headline?: string;
}
