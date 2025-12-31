// ==========================================
// CONFLICT HANDLERS (FOR NL + UI) — A210 (HARDENED)
// FILE: uiux/advanced/conflicts/conflict_handlers.ts
// Bridges ConflictStore actions into the NL CommandHandlers expected contract.
// ==========================================

import type { ConflictStore } from "./conflict_store";
import type { AuditLogger } from "../audit/audit_logger";

export function makeConflictHandlers(opts: {
  store: ConflictStore;
  audit?: AuditLogger;
}) {
  return {
    ackConflict: async (id: string) => {
      const ok = opts.store.ack(id);
      await opts.audit?.log("conflict", "conflict.ack", ok, { id });
      return { ok, message: ok ? `acked ${id}` : `cannot ack ${id}` };
    },

    autoAckConflicts: async () => {
      const r = opts.store.autoAckEligible();
      const ok = true;
      await opts.audit?.log("conflict", "conflict.auto_ack", ok, r);
      return { ok, message: `auto-acked ${r.acked} conflicts` };
    },
  };
}
