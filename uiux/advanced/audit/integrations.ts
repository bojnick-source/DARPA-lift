// ==========================================
// AUDIT LOGGING (JSONL + HASH CHAIN) — A34 (HARDENED)
// Drop-in audit hooks for NL+CRDT bridge + presence + pipelines.
// ==========================================

import type { AuditLogger } from "./audit_logger";

export function makeNLAuditHook(a: AuditLogger) {
  return (evt: { ok: boolean; reason?: string; actions?: any[]; action?: any }) => {
    if (evt.ok) a.log("nl.actions", true, { actions: evt.actions ?? evt.action ?? null });
    else a.log("nl.reject", false, { reason: evt.reason ?? "UNKNOWN", action: evt.action ?? null });
  };
}

export function makePresenceAuditHook(a: AuditLogger) {
  return (states: Array<{ clientId: number; state: any }>) => {
    // Keep this light: presence can be high-frequency
    a.log("presence.update", true, { n: states.length });
  };
}

export function wrapPipelineRunner(
  a: AuditLogger,
  run: (p: string) => Promise<void>
): (p: string) => Promise<void> {
  return async (p: string) => {
    await a.log("pipeline.start", true, { pipeline: p });
    try {
      await run(p);
      await a.log("pipeline.ok", true, { pipeline: p });
    } catch (e: any) {
      await a.log("pipeline.fail", false, { pipeline: p, error: String(e?.message ?? e) });
      throw e;
    }
  };
}
