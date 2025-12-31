// ==========================================
// DETERMINISTIC REPLAY — A35 (HARDENED)
// Replays audit events into a deterministic state store.
// Focus: NL actions + CRDT sets + pipeline markers (for timeline).
// ==========================================

import type { AuditEvent } from "../audit_types";
import { sha256Hex } from "../hash";
import { ReplayStateStore } from "./state_store";

export interface ReplayMetrics {
  events: number;
  appliedSets: number;
  rejected: number;
  pipelinesStarted: number;
  pipelinesFailed: number;
  finalStateHashHex: string;
}

export interface ReplayOptions {
  // Only apply set_value path actions that match these prefixes (defense)
  allowedPrefixes?: string[];
}

function allowed(path: string, prefixes?: string[]): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((p) => path.startsWith(p));
}

function extractSetOpsFromNlActions(payload: any): Array<{ path: string; value: any }> {
  const actions = payload?.actions;
  const out: Array<{ path: string; value: any }> = [];
  if (!Array.isArray(actions)) return out;

  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    if (a.type !== "set_value") continue;
    const path = String(a.path ?? "");
    if (!path) continue;
    out.push({ path, value: (a as any).value });
  }
  return out;
}

function extractSetFromCrdt(payload: any): { path: string; value: any } | null {
  // Expected: payload like { path, value } or { set: { path, value } }
  const p = payload?.path ? payload : payload?.set;
  if (!p) return null;
  const path = String(p.path ?? "");
  if (!path) return null;
  return { path, value: p.value };
}

export async function replayAuditLog(
  events: AuditEvent[],
  opts: ReplayOptions = {}
): Promise<{ store: ReplayStateStore; metrics: ReplayMetrics }> {
  const store = new ReplayStateStore();

  let appliedSets = 0;
  let rejected = 0;
  let pipelinesStarted = 0;
  let pipelinesFailed = 0;

  for (const e of events) {
    if (e.type === "nl.actions" && e.ok) {
      const sets = extractSetOpsFromNlActions(e.payload);
      for (const s of sets) {
        if (!allowed(s.path, opts.allowedPrefixes)) {
          rejected++;
          continue;
        }
        store.set(s.path, s.value);
        appliedSets++;
      }
      continue;
    }

    if (e.type === "crdt.set" && e.ok) {
      const s = extractSetFromCrdt(e.payload);
      if (!s) continue;
      if (!allowed(s.path, opts.allowedPrefixes)) {
        rejected++;
        continue;
      }
      store.set(s.path, s.value);
      appliedSets++;
      continue;
    }

    if (e.type === "pipeline.start" && e.ok) pipelinesStarted++;
    if (e.type === "pipeline.fail" && !e.ok) pipelinesFailed++;
  }

  const finalStable = store.stableStringify();
  const finalHashHex = await sha256Hex(finalStable);

  return {
    store,
    metrics: {
      events: events.length,
      appliedSets,
      rejected,
      pipelinesStarted,
      pipelinesFailed,
      finalStateHashHex: finalHashHex,
    },
  };
}
