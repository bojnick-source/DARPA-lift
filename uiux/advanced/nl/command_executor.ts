// ==========================================
// EXECUTION WRAPPER (AUDIT + SAFE FAIL) — A195 (HARDENED)
// FILE: uiux/advanced/nl/command_executor.ts
// Binds parsed commands to handlers, emits audit events, prevents drift.
// ==========================================

import type { CommandContext, CommandResult, ParsedCommand } from "./command_types";
import { getCommand } from "./command_registry";
import { guardCommand } from "./command_guards";

export interface CommandHandlers {
  // navigation
  openPanel: (panel: string) => Promise<CommandResult>;

  // collab
  setReferencePeer: (peer: string | null) => Promise<CommandResult>;
  requestSnapshot: (peer: string) => Promise<CommandResult>;
  forcePublish: () => Promise<CommandResult>;

  // conflicts
  ackConflict: (id: string) => Promise<CommandResult>;
  autoAckConflicts: () => Promise<CommandResult>;

  // robustness gates
  setRobustnessGate: (name: string, value: number) => Promise<CommandResult>;

  // optimizer
  startOptimization: () => Promise<CommandResult>;
  stopOptimization: () => Promise<CommandResult>;

  // help
  help: () => Promise<CommandResult>;
}

export interface AuditSink {
  log: (event: string, ok: boolean, payload?: any) => Promise<void> | void;
}

export async function executeParsedCommand(opts: {
  parsed: ParsedCommand;
  ctx: CommandContext;
  handlers: CommandHandlers;
  audit?: AuditSink;

  // if provided, caller can supply a confirm token for guarded commands
  confirmed?: boolean;
}): Promise<CommandResult> {
  const parsed = opts.parsed;
  if (!parsed.ok) return { ok: false, message: parsed.error ?? "parse error" };

  const def = getCommand(parsed.id!);
  if (!def) return { ok: false, message: "unknown command id" };

  const guard = guardCommand(def, parsed, opts.ctx);
  if (!guard.ok) return { ok: false, message: guard.reason ?? "blocked" };

  if (guard.requiresConfirm && !opts.confirmed) {
    return { ok: false, message: `confirm required: ${def.title}` };
  }

  const args = parsed.args ?? {};
  try {
    let res: CommandResult;

    switch (def.id) {
      case "help":
        res = await opts.handlers.help();
        break;

      case "open_panel":
        res = await opts.handlers.openPanel(String(args.panel ?? ""));
        break;

      case "set_reference_peer":
        res = await opts.handlers.setReferencePeer(args.peer ?? null);
        break;

      case "request_snapshot":
        res = await opts.handlers.requestSnapshot(String(args.peer));
        break;

      case "force_publish":
        res = await opts.handlers.forcePublish();
        break;

      case "ack_conflict":
        res = await opts.handlers.ackConflict(String(args.id));
        break;

      case "auto_ack_conflicts":
        res = await opts.handlers.autoAckConflicts();
        break;

      case "set_robustness_gate":
        res = await opts.handlers.setRobustnessGate(String(args.name), Number(args.value));
        break;

      case "start_optimization":
        res = await opts.handlers.startOptimization();
        break;

      case "stop_optimization":
        res = await opts.handlers.stopOptimization();
        break;

      default:
        res = { ok: false, message: "no handler" };
        break;
    }

    await opts.audit?.log("nl.exec", res.ok, { id: def.id, args, msg: res.message });
    return res;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await opts.audit?.log("nl.exec", false, { id: def.id, args, err: msg });
    return { ok: false, message: msg };
  }
}
