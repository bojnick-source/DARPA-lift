// ==========================================
// CRDT UPGRADE TYPES — A216 (HARDENED)
// FILE: uiux/advanced/crdt_upgrade/upgrade_types.ts
// ==========================================

export type UpgradeRole = "host" | "editor" | "viewer";

export type UpgradePhase =
  | "idle"
  | "proposed"
  | "voting"
  | "approved"
  | "applying"
  | "verifying"
  | "completed"
  | "failed"
  | "aborted";

export interface CRDTMeta {
  schemaVersion: string;
  stateHash: string;
  atMs: number;
}

export interface UpgradeContext {
  v: 1;
  role: UpgradeRole;
  isCollaborative: boolean;
  clientTag: string;
}

export interface MigrationStep<State = any> {
  id: string;              // stable, e.g. "m_001"
  from: string;            // schemaVersion
  to: string;              // schemaVersion
  description: string;

  // deterministic transform (MUST NOT use Date.now/random)
  migrate: (state: State) => State;

  // optional assertions to harden
  validate?: (state: State) => { ok: boolean; error?: string };
}

export interface UpgradePlan {
  v: 1;
  planId: string;          // deterministic-ish
  from: string;
  to: string;
  steps: Array<Pick<MigrationStep, "id" | "from" | "to" | "description">>;
}

export interface UpgradeProposal {
  v: 1;
  proposalId: string;
  createdAtMs: number;
  createdBy: string;       // clientTag
  plan: UpgradePlan;

  // deterministic pre-checks
  precheck: {
    ok: boolean;
    notes: string[];
    fromMeta?: CRDTMeta;
  };
}

export interface UpgradeVote {
  v: 1;
  proposalId: string;
  from: string;            // clientTag
  atMs: number;
  vote: "approve" | "reject";
  reason?: string;
}

export interface UpgradeStatus {
  v: 1;
  proposalId: string;
  phase: UpgradePhase;
  atMs: number;

  // if failed
  error?: string;

  // verification results (optional)
  verify?: {
    ok: boolean;
    localMeta?: CRDTMeta;
    converged?: boolean; // hash convergence with reference/host after apply
    determinismOk?: boolean;
    notes?: string[];
  };
}

export interface UpgradeSnapshot {
  v: 1;
  atMs: number;

  phase: UpgradePhase;

  // known peers
  peers: Array<{ clientTag: string; schemaVersion?: string; stateHash?: string }>;

  // active proposal, votes, status
  proposal?: UpgradeProposal;
  votes?: UpgradeVote[];
  status?: UpgradeStatus;
}
