// ==========================================
// CRDT ABSTRACTION (UPGRADE + HASH CONTRACT) — A170 (HARDENED)
// FILE: uiux/advanced/crdt/crdt_types.ts
// Goal: a single, deterministic contract for state, ops, migrations, and hashing.
// ==========================================

export type CRDTProviderKind = "automerge" | "yjs" | "memory";

export interface CRDTMeta {
  v: 1;

  // Canonical schema version for the *application state* (not the CRDT lib)
  schemaVersion: string;

  // Monotonic logical clock from provider (Lamport/vector/etc). Optional.
  clock?: string;

  // Deterministic state hash (canonical serialization -> sha256)
  stateHash: string;

  // When this state was produced (ms)
  atMs: number;

  // Optional: who produced it
  clientTag?: string;
}

export interface CRDTOpEnvelope {
  v: 1;
  provider: CRDTProviderKind;

  // Provider-specific op payload (encoded bytes/base64 or JSON)
  payload: any;

  // Optional: provider clock info
  clock?: string;

  // Deterministic op hash (canonical serialization -> sha256)
  opHash: string;

  atMs: number;
  from?: string;
}

export interface CRDTSnapshotEnvelope {
  v: 1;
  provider: CRDTProviderKind;

  // Provider-specific snapshot payload (encoded)
  snapshot: any;

  // App schema version of the contained state
  schemaVersion: string;

  // Deterministic state hash (canonical)
  stateHash: string;

  atMs: number;
}

export interface CRDTApplyResult {
  ok: boolean;
  error?: string;

  // Updated meta after applying ops/snapshot
  meta?: CRDTMeta;

  // Whether state changed
  changed?: boolean;
}

export interface CRDTExportBundle {
  v: 1;
  provider: CRDTProviderKind;
  schemaVersion: string;

  // deterministic hash of exported bundle
  bundleHash: string;

  // snapshot + pending ops if provider supports it
  snapshot: CRDTSnapshotEnvelope;

  // optional op log for replay
  ops?: CRDTOpEnvelope[];
}

export interface CRDTProvider<State> {
  kind: CRDTProviderKind;

  // Local identity (must be stable for a session)
  getClientTag(): string;

  // Get canonical app state (already migrated to target schemaVersion)
  getState(): State;

  // Get deterministic meta for current state
  getMeta(): Promise<CRDTMeta>;

  // Apply a local change function and return an op envelope to broadcast (if provider supports ops)
  // IMPORTANT: changeFn MUST be pure relative to State (no Date.now inside).
  change(changeFn: (draft: State) => void, note?: string): Promise<{ result: CRDTApplyResult; op?: CRDTOpEnvelope }>;

  // Apply a remote op
  applyOp(op: CRDTOpEnvelope): Promise<CRDTApplyResult>;

  // Apply snapshot (e.g., initial sync)
  applySnapshot(snap: CRDTSnapshotEnvelope): Promise<CRDTApplyResult>;

  // Export a bundle (snapshot + optional oplog)
  exportBundle(opts?: { includeOps?: boolean; maxOps?: number }): Promise<CRDTExportBundle>;

  // Hard reset to a known state (local only)
  reset(state: State, schemaVersion: string): Promise<CRDTApplyResult>;
}
