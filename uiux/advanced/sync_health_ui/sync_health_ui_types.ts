// ==========================================
// SYNC HEALTH UI TYPES — A242 (HARDENED)
// FILE: uiux/advanced/sync_health_ui/sync_health_ui_types.ts
// UI adapter so dashboard stays stable even if internal SyncHealthStore changes.
// ==========================================

export interface PeerStatus {
  clientTag: string;
  schemaVersion: string;
  hash: string;
  publishedMs: number;

  // derived (optional)
  isReference?: boolean;
}

export interface HashMismatchEvent {
  id: string;
  atMs: number;
  referencePeer?: string | null;
  localHash?: string;
  remoteHash?: string;
  note?: string;
}

export interface DeterminismCheckStatus {
  v: 1;
  ok: boolean;
  checkedAtMs: number;
  source: string;
  total?: number;
  mismatches?: number;
  firstMismatch?: any;
}

export type GateComparator = "<=" | ">=";

export interface RobustnessGate {
  id: string;                 // stable id
  metric: string;             // e.g. "unsafe_contact_rate"
  comparator: GateComparator; // "<=" or ">="
  threshold: number;          // numeric
  quantile?: "q10" | "q50" | "q90" | "cvar95" | "mean" | "max"; // optional
  severity?: "warn" | "critical"; // optional
}

export interface GateMetricSample {
  metric: string;
  value: number;
  atMs: number;
  // optional provenance
  source?: string;
}

export interface GateEval {
  gateId: string;
  ok: boolean;
  value?: number;
  threshold: number;
  comparator: GateComparator;
  metric: string;
  note?: string;
}

export interface SyncHealthSnapshot {
  referencePeer: string | null;

  peers: PeerStatus[];

  mismatches: HashMismatchEvent[];

  determinism?: DeterminismCheckStatus | null;

  // policy + latest samples
  gates: RobustnessGate[];
  samples: GateMetricSample[];

  // derived evaluations
  gateEvals: GateEval[];

  // conflict counts (optional passthrough)
  conflictCounts?: { open: number; criticalOpen?: number };
}

export interface SyncHealthUIAdapter {
  // snapshot getter (UI should poll or subscribe)
  get: () => SyncHealthSnapshot;

  // optional subscription
  onChange?: (cb: () => void) => () => void;

  // actions
  setReferencePeer?: (peer: string | null) => Promise<void> | void;

  // "force resync" is implemented by requesting a snapshot from peer; dashboard will call external helper.
}
