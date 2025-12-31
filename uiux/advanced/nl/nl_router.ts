// ==========================================
// NL ROUTER (AUDIT + CONFLICT INTEGRATION) — A226 (HARDENED)
// FILE: uiux/advanced/nl/nl_router.ts
// ==========================================

import type { AuditLogger } from "../audit/audit_logger";
import type { ConflictStore } from "../conflicts/conflict_store";
import type { CommandContext, CommandRegistry, CommandResult } from "./command_registry";

export class NLCommandRouter {
  private registry: CommandRegistry;
  private audit?: AuditLogger;
  private conflicts?: ConflictStore;

  constructor(opts: { registry: CommandRegistry; audit?: AuditLogger; conflicts?: ConflictStore }) {
    this.registry = opts.registry;
    this.audit = opts.audit;
    this.conflicts = opts.conflicts;
  }

  async exec(text: string, ctx: CommandContext): Promise<CommandResult> {
    const parsed = this.registry.parse(text);

    if (!parsed.ok || !parsed.commandId) {
      await this.audit?.log("nl", "nl.parse", false, { text, reason: parsed.reason });
      return { ok: false, safe: true, message: parsed.reason ?? "could not parse" };
    }

    const cmd = this.registry.get(parsed.commandId);
    if (!cmd) {
      await this.audit?.log("nl", "nl.unknown_cmd", false, { commandId: parsed.commandId, text });
      return { ok: false, safe: true, message: "unknown command" };
    }

    // policy gates
    if (cmd.requiresRole?.length) {
      const role = ctx.role ?? "viewer";
      if (!cmd.requiresRole.includes(role as any)) {
        await this.audit?.log("nl", "nl.role_denied", false, { cmd: cmd.id, role });
        return { ok: false, safe: true, message: `requires role: ${cmd.requiresRole.join(", ")}` };
      }
    }

    if (cmd.requiresSelection && !ctx.selection) {
      await this.audit?.log("nl", "nl.selection_missing", false, { cmd: cmd.id });
      return { ok: false, safe: true, message: "requires selection" };
    }

    const auditEv = await this.audit?.log("nl", "nl.exec.start", true, {
      cmd: cmd.id,
      args: parsed.args,
      clientTag: ctx.clientTag,
      scope: cmd.scope,
    });

    try {
      const res = await cmd.run(parsed.args ?? {}, ctx);

      await this.audit?.log("nl", "nl.exec.done", res.ok, {
        cmd: cmd.id,
        requestAuditId: auditEv?.id,
        res: { ok: res.ok, message: res.message },
      });

      if (!res.ok && res.safe === false && this.conflicts) {
        await this.conflicts.add({
          severity: "warn",
          kind: "nl_command_failed",
          title: "NL command failed",
          detail: res.message ?? "unknown",
          payload: { cmd: cmd.id, args: parsed.args, requestAuditId: auditEv?.id },
          recommendedAction: "manual_merge",
        });
      }

      return res;
    } catch (e: any) {
      const err = String(e?.message ?? e);
      await this.audit?.log("nl", "nl.exec.error", false, { cmd: cmd.id, err, requestAuditId: auditEv?.id });

      if (this.conflicts) {
        await this.conflicts.add({
          severity: "critical",
          kind: "nl_command_failed",
          title: "NL command exception",
          detail: err,
          payload: { cmd: cmd.id, requestAuditId: auditEv?.id },
          recommendedAction: "request_snapshot",
        });
      }

      return { ok: false, safe: false, message: err };
    }
  }
}
