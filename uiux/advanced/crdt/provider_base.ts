// ==========================================
// PROVIDER BASE (DETERMINISTIC HASH CONTRACT) — A174 (HARDENED)
// FILE: uiux/advanced/crdt/provider_base.ts
// Shared helpers for providers: meta, op hashing, snapshot hashing.
// ==========================================

import type { CRDTMeta, CRDTOpEnvelope, CRDTSnapshotEnvelope } from "./crdt_types";
import { canonicalJSONStringify } from "./canonicalize";
import { sha256Hex } from "./hash";

export async function computeStateHash(state: any): Promise<string> {
  return sha256Hex(canonicalJSONStringify(state));
}

export async function computeOpHash(opPayload: any): Promise<string> {
  return sha256Hex(canonicalJSONStringify(opPayload));
}

export async function makeMeta(opts: {
  schemaVersion: string;
  state: any;
  clientTag?: string;
  clock?: string;
  atMs?: number;
}): Promise<CRDTMeta> {
  const atMs = opts.atMs ?? Date.now();
  const stateHash = await computeStateHash({ schemaVersion: opts.schemaVersion, state: opts.state });
  return { v: 1, schemaVersion: opts.schemaVersion, stateHash, clock: opts.clock, atMs, clientTag: opts.clientTag };
}

export async function makeSnapshot(opts: {
  provider: "automerge" | "yjs" | "memory";
  schemaVersion: string;
  state: any;
  snapshot: any;
  atMs?: number;
}): Promise<CRDTSnapshotEnvelope> {
  const atMs = opts.atMs ?? Date.now();
  const stateHash = await computeStateHash({ schemaVersion: opts.schemaVersion, state: opts.state });
  return { v: 1, provider: opts.provider, schemaVersion: opts.schemaVersion, snapshot: opts.snapshot, stateHash, atMs };
}

export async function makeOpEnvelope(opts: {
  provider: "automerge" | "yjs" | "memory";
  payload: any;
  clock?: string;
  from?: string;
  atMs?: number;
}): Promise<CRDTOpEnvelope> {
  const atMs = opts.atMs ?? Date.now();
  const opHash = await computeOpHash({ provider: opts.provider, payload: opts.payload, clock: opts.clock ?? null });
  return { v: 1, provider: opts.provider, payload: opts.payload, clock: opts.clock, opHash, atMs, from: opts.from };
}
