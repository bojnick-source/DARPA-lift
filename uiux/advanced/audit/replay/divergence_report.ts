// ==========================================
// DIVERGENCE DETECTOR — A37 (HARDENED)
// Convenience: compare two JSONL logs by replaying both, verifying hash chains,
// then producing a single report object.
// ==========================================

import type { AuditEvent } from "../audit_types";
import { verifyHashChain } from "./hash_chain_verify";
import { replayAuditLog } from "./replay_engine";
import { compareStores, type DiffStats } from "./divergence";
import { parseJsonl } from "./jsonl";

export interface DivergenceReport {
  ok: boolean;
  hashChainA: { ok: boolean; checked: number; firstBadIndex?: number; reason?: string };
  hashChainB: { ok: boolean; checked: number; firstBadIndex?: number; reason?: string };
  metricsA?: any;
  metricsB?: any;
  diff?: DiffStats;
}

export async function compareJsonlLogs(
  jsonlA: string,
  jsonlB: string,
  allowedPrefixes: string[]
): Promise<DivergenceReport> {
  const eventsA = parseJsonl(jsonlA);
  const eventsB = parseJsonl(jsonlB);

  return compareEventLogs(eventsA, eventsB, allowedPrefixes);
}

export async function compareEventLogs(
  eventsA: AuditEvent[],
  eventsB: AuditEvent[],
  allowedPrefixes: string[]
): Promise<DivergenceReport> {
  const hcA = await verifyHashChain(eventsA);
  const hcB = await verifyHashChain(eventsB);

  if (!hcA.ok || !hcB.ok) {
    return { ok: false, hashChainA: hcA, hashChainB: hcB };
    }

  const ra = await replayAuditLog(eventsA, { allowedPrefixes });
  const rb = await replayAuditLog(eventsB, { allowedPrefixes });

  const diff = compareStores(ra.store, rb.store);

  return {
    ok: diff.mismatchedPaths === 0,
    hashChainA: hcA,
    hashChainB: hcB,
    metricsA: ra.metrics,
    metricsB: rb.metrics,
    diff,
  };
}
