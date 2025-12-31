// ==========================================
// PERMISSION + CONFIRMATION GATES — A194 (HARDENED)
// FILE: uiux/advanced/nl/command_guards.ts
// Prevents dangerous actions in collaborative mode unless host + confirm.
// ==========================================

import type { CommandDef, CommandContext, ParsedCommand } from "./command_types";
import { roleAllows } from "./command_registry";

export interface GuardDecision {
  ok: boolean;
  reason?: string;

  // requires user confirm step
  requiresConfirm?: boolean;
}

export function guardCommand(def: CommandDef, parsed: ParsedCommand, ctx: CommandContext): GuardDecision {
  if (!parsed.ok) return { ok: false, reason: parsed.error ?? "parse error" };
  if (!roleAllows(ctx.role, def.minRole)) return { ok: false, reason: "insufficient role" };

  // hard rule: dangerous commands require host in collaborative mode
  if (ctx.isCollaborative && def.risk === "dangerous" && ctx.role !== "host") {
    return { ok: false, reason: "dangerous commands require host in collaborative mode" };
  }

  if (def.requireConfirm) return { ok: true, requiresConfirm: true };

  // extra: any "dangerous" command should confirm when collaborative
  if (ctx.isCollaborative && def.risk === "dangerous") {
    return { ok: true, requiresConfirm: true };
  }

  return { ok: true };
}
