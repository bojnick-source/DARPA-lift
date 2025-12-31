// ==========================================
// SANDBOXED AI TOOL-CALL LAYER — A54 (HARDENED)
// AI -> actions -> (role guard + allowlists + confirm gate) -> execute.
// This is the ONLY place the AI is allowed to trigger UI mutations.
// ==========================================

import type { CommandExec } from "../nl/command_router";
import { executeActions } from "../nl/command_router";
import type { ToolCallPolicy } from "./toolcall_policy";
import { DEFAULT_TOOLCALL_POLICY, needsConfirmation } from "./toolcall_policy";
import type { ApprovalGate } from "./approval_gate";

export interface SandboxedExecutorOptions {
  exec: CommandExec;               // already wrapped by CRDT bridge + role guard
  approval: ApprovalGate;
  policy?: ToolCallPolicy;
  audit?: (e: { ok: boolean; reason?: string; actions?: any[] }) => void;
}

export class SandboxedExecutor {
  private exec: CommandExec;
  private approval: ApprovalGate;
  private policy: ToolCallPolicy;
  private audit?: (e: { ok: boolean; reason?: string; actions?: any[] }) => void;

  constructor(opts: SandboxedExecutorOptions) {
    this.exec = opts.exec;
    this.approval = opts.approval;
    this.policy = opts.policy ?? DEFAULT_TOOLCALL_POLICY;
    this.audit = opts.audit;
  }

  async run(actions: any[], humanText?: string): Promise<boolean> {
    if (!Array.isArray(actions) || actions.length === 0) {
      this.audit?.({ ok: false, reason: "NO_ACTIONS", actions });
      return false;
    }

    if (needsConfirmation(actions, this.policy)) {
      const ok = await this.approval.requestApproval({
        title: "Approve AI action",
        summary: humanText ?? "AI proposed actions that may be costly or risky.",
        actions,
      });
      if (!ok) {
        this.audit?.({ ok: false, reason: "USER_DENIED", actions });
        return false;
      }
    }

    try {
      executeActions(actions, this.exec);
      this.audit?.({ ok: true, actions });
      return true;
    } catch (e: any) {
      this.audit?.({ ok: false, reason: `EXEC_FAILED:${String(e?.message ?? e)}`, actions });
      return false;
    }
  }
}
