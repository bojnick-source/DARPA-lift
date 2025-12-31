// ==========================================
// COLLAB KERNEL TYPES — A222 (HARDENED)
// FILE: uiux/advanced/collab/collab_types.ts
// One place to wire transport + CRDT + audit + conflicts + sync health + NL + upgrade.
// ==========================================

import type { AuditLogger } from "../audit/audit_logger";
import type { ConflictStore } from "../conflicts/conflict_store";
import type { SyncHealthStore } from "../sync/sync_health_store";
import type { CRDTUpgradeManager } from "../crdt_upgrade/upgrade_manager";
import type { UpgradeMsg } from "../crdt_upgrade/upgrade_protocol";

// Transport contract (minimal; aligns with usage in upgrade_manager.ts)
export interface RTTransport {
  // send a JSON-serializable message
  send: (msg: any) => Promise<void>;

  // lifecycle
  connect?: () => Promise<void>;
  close?: () => Promise<void>;

  // subscription
  onMessage: (cb: (msg: any) => void) => () => void;
  onOpen?: (cb: () => void) => () => void;
  onClose?: (cb: (reason?: any) => void) => () => void;
  onError?: (cb: (err: any) => void) => () => void;
}

// Presence contract (optional; can be no-op)
export interface PresenceProvider {
  setSelf: (meta: any) => Promise<void> | void;
  listPeers: () => Array<{ clientTag: string; meta?: any }>;
  onChange?: (cb: () => void) => () => void;
}

// CRDT contract used by the kernel
export interface CRDTProvider<State = any> {
  // authoritative local state operations
  applyOp: (op: any) => Promise<void>;
  exportSnapshot: () => Promise<{ meta: { schemaVersion: string; stateHash: string; atMs: number }; state: State }>;
  importSnapshot: (snap: { meta: { schemaVersion: string; stateHash: string; atMs: number }; state: State }) => Promise<void>;
  getMeta: () => Promise<{ schemaVersion: string; stateHash: string; atMs: number }>;

  // optional (improves correctness)
  computeStateHash?: (state: State) => Promise<string>;

  // if CRDT emits events (optional)
  onLocalOp?: (cb: (op: any) => void) => () => void;
}

// Natural language command router (optional)
export interface NLCommandRouter {
  // parse + route (string input) -> result
  exec: (text: string, ctx?: any) => Promise<{ ok: boolean; message?: string; data?: any }>;
}

// Robustness gate policy source (optional)
export interface RobustnessPolicySource {
  // returns the list of gate definitions used by SyncHealthStore.setGates(...)
  getGates: () => Promise<any[]>;
}

export interface CollabKernelConfig {
  clientTag: string;

  // collaboration
  referencePeer?: string | null;

  // heartbeat publishing cadence
  publishHashEveryMs?: number;

  // strictness
  strictSchemaMatch?: boolean; // if true, schema mismatch becomes critical conflict

  // deterministic replay checks (optional)
  determinismCheckFn?: () => Promise<{ ok: boolean; source: string; total?: number; mismatches?: number; firstMismatch?: any }>;
}

export interface CollabKernelDeps<State = any> {
  transport: RTTransport;
  crdt: CRDTProvider<State>;

  // optional subsystems
  presence?: PresenceProvider;
  audit?: AuditLogger;
  conflicts?: ConflictStore;
  syncHealth?: SyncHealthStore;
  nl?: NLCommandRouter;
  upgrade?: CRDTUpgradeManager<State>;
  robustnessPolicy?: RobustnessPolicySource;
}

export type KernelInbound =
  | { kind: "rt"; msg: any } // unknown RT message
  | { kind: "nl"; text: string; from?: string }
  | { kind: "upgrade"; msg: UpgradeMsg };

export type KernelState = "idle" | "running" | "closed";
