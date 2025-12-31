// ==========================================
// ROLE-BASED PERMISSIONS — A50 (HARDENED)
// Wraps a CommandExec with role checks.
// ==========================================

import type { CommandExec } from "./command_router";
import type { Role } from "../auth/roles";
import { requirePerm } from "../auth/policy_enforcer";
import { haptic } from "../haptics";

export interface RoleGuardOptions {
  role: Role;
  audit?: (e: { ok: boolean; reason?: string; action?: any }) => void;
}

export function withRoleGuard(exec: CommandExec, opts: RoleGuardOptions): CommandExec {
  return {
    setValue(path: string, value: any): void {
      const r = requirePerm(opts.role, "ui.write");
      if (!r.ok) {
        opts.audit?.({ ok: false, reason: r.reason, action: { type: "set_value", path } });
        haptic("error");
        return;
      }
      exec.setValue(path, value);
    },

    openPanel(panel: string): void {
      const r = requirePerm(opts.role, "panel.open");
      if (!r.ok) {
        opts.audit?.({ ok: false, reason: r.reason, action: { type: "open_panel", panel } });
        haptic("error");
        return;
      }
      exec.openPanel(panel);
    },

    runPipeline(pipeline: string): void {
      // fine-grained pipeline perms
      if (pipeline === "optimize_cmaes") {
        const r = requirePerm(opts.role, "pipeline.run.optimize");
        if (!r.ok) {
          opts.audit?.({ ok: false, reason: r.reason, action: { type: "run_pipeline", pipeline } });
          haptic("error");
          return;
        }
      } else if (pipeline === "run_monte_carlo") {
        const r = requirePerm(opts.role, "pipeline.run.montecarlo");
        if (!r.ok) {
          opts.audit?.({ ok: false, reason: r.reason, action: { type: "run_pipeline", pipeline } });
          haptic("error");
          return;
        }
      } else if (pipeline === "generate_mjcf") {
        const r = requirePerm(opts.role, "pipeline.run.mjcf");
        if (!r.ok) {
          opts.audit?.({ ok: false, reason: r.reason, action: { type: "run_pipeline", pipeline } });
          haptic("error");
          return;
        }
      } else {
        const r = requirePerm(opts.role, "pipeline.run");
        if (!r.ok) {
          opts.audit?.({ ok: false, reason: r.reason, action: { type: "run_pipeline", pipeline } });
          haptic("error");
          return;
        }
      }

      exec.runPipeline(pipeline);
    },
  };
}
