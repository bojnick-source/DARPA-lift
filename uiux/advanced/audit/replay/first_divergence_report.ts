// ==========================================
// FIRST DIVERGENCE LOCATOR — A40 (HARDENED)
// Produces a compact report + the window of events around divergence.
// ==========================================

import type { AuditEvent } from "../audit_types";
import { verifyHashChain } from "./hash_chain_verify";
import { findFirstDivergence } from "./first_divergence";

export interface DivergenceWindow {
  start: number;
  end: number;
  eventsA: AuditEvent[];
  eventsB: AuditEvent[];
}

export interface FirstDivergenceReport {
  ok: boolean;
  hashChainA: any;
  hashChainB: any;
  firstIndex?: number;
  leftHash?: string;
  rightHash?: string;
  window?: DivergenceWindow;
  note?: string;
}

export async function buildFirstDivergenceReport(
  eventsA: AuditEvent[],
  eventsB: AuditEvent[],
  allowedPrefixes: string[],
  windowRadius = 5
): Promise<FirstDivergenceReport> {
  const hcA = await verifyHashChain(eventsA);
  const hcB = await verifyHashChain(eventsB);

  if (!hcA.ok || !hcB.ok) {
    return { ok: false, hashChainA: hcA, hashChainB: hcB };
  }

  const fd = await findFirstDivergence(eventsA, eventsB, allowedPrefixes);
  if (fd.ok) {
    return { ok: true, hashChainA: hcA, hashChainB: hcB };
  }

  const idx = fd.firstIndex ?? 0;
  const start = Math.max(0, idx - windowRadius);
  const end = idx + windowRadius;

  return {
    ok: false,
    hashChainA: hcA,
    hashChainB: hcB,
    firstIndex: idx,
    leftHash: fd.leftHash,
    rightHash: fd.rightHash,
    note: fd.note,
    window: {
      start,
      end,
      eventsA: eventsA.slice(start, Math.min(end, eventsA.length)),
      eventsB: eventsB.slice(start, Math.min(end, eventsB.length)),
    },
  };
}
