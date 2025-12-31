// ==========================================
// FIRST DIVERGENCE LOCATOR — A39 (HARDENED)
// Finds earliest event index where two logs diverge in derived state.
// Strategy:
//   - replay prefixes of logs
//   - compare stable state hashes
//   - binary search to locate first differing prefix
// Notes:
//   - Requires both logs be comparable streams (same logical timeline family).
//   - Uses allowedPrefixes gate to avoid noise.
// ==========================================

import type { AuditEvent } from "../audit_types";
import { replayAuditLog } from "./replay_engine";
import { sha256Hex } from "../hash";

export interface FirstDivergenceResult {
  ok: boolean;                 // ok=true means no divergence
  firstIndex?: number;         // earliest prefix length where mismatch appears
  leftHash?: string;           // hash at (firstIndex-1)
  rightHash?: string;          // hash at (firstIndex)
  note?: string;
}

/**
 * Build a stable hash for a replay prefix.
 */
async function prefixHash(events: AuditEvent[], n: number, allowedPrefixes: string[]): Promise<string> {
  const slice = events.slice(0, n);
  const { store } = await replayAuditLog(slice, { allowedPrefixes });
  const stable = store.stableStringify();
  return await sha256Hex(stable);
}

/**
 * Locate earliest index where hashes differ (binary search).
 * If logs are different lengths, we search up to minLen.
 */
export async function findFirstDivergence(
  eventsA: AuditEvent[],
  eventsB: AuditEvent[],
  allowedPrefixes: string[]
): Promise<FirstDivergenceResult> {
  const nMax = Math.min(eventsA.length, eventsB.length);

  const hEndA = await prefixHash(eventsA, nMax, allowedPrefixes);
  const hEndB = await prefixHash(eventsB, nMax, allowedPrefixes);
  if (hEndA === hEndB) {
    // If one log is longer, divergence may occur after minLen.
    if (eventsA.length === eventsB.length) return { ok: true };
    return {
      ok: false,
      firstIndex: nMax + 1,
      note: "States match through min length; divergence may occur after due to extra events in one log.",
      leftHash: hEndA,
      rightHash: "",
    };
  }

  // Binary search for earliest differing prefix
  let lo = 1;
  let hi = nMax;
  let first = hi;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const ha = await prefixHash(eventsA, mid, allowedPrefixes);
    const hb = await prefixHash(eventsB, mid, allowedPrefixes);

    if (ha === hb) {
      lo = mid + 1;
    } else {
      first = mid;
      hi = mid - 1;
    }
  }

  const leftIdx = Math.max(0, first - 1);
  const leftHashA = await prefixHash(eventsA, leftIdx, allowedPrefixes);
  const leftHashB = await prefixHash(eventsB, leftIdx, allowedPrefixes);

  // left hashes should match; if they don't, our first is not minimal (or non-determinism)
  const leftHash = leftHashA === leftHashB ? leftHashA : "";

  const rightHashA = await prefixHash(eventsA, first, allowedPrefixes);
  const rightHashB = await prefixHash(eventsB, first, allowedPrefixes);

  return {
    ok: false,
    firstIndex: first,
    leftHash,
    rightHash: rightHashA + "|" + rightHashB,
  };
}
