// ==========================================
// SANDBOXED AI TOOL-CALL LAYER — A52 (HARDENED)
// Defines which AI actions are "high-cost" and require confirmation.
// ==========================================

export type ActionType = "set_value" | "open_panel" | "run_pipeline";

export interface ToolCallPolicy {
  // Always enforced by allowlists elsewhere; this adds confirmation gates.
  confirm: {
    enabled: boolean;
    // require confirmation for these pipelines (costly / risky)
    pipelines: string[];
    // optional: require confirmation if action list includes more than N actions
    maxActionsWithoutConfirm: number;
  };
}

export const DEFAULT_TOOLCALL_POLICY: ToolCallPolicy = {
  confirm: {
    enabled: true,
    pipelines: ["run_monte_carlo", "optimize_cmaes"],
    maxActionsWithoutConfirm: 3,
  },
};

export function needsConfirmation(actions: any[], policy: ToolCallPolicy): boolean {
  if (!policy.confirm.enabled) return false;
  if (!Array.isArray(actions)) return false;
  if (actions.length > policy.confirm.maxActionsWithoutConfirm) return true;

  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    if (a.type === "run_pipeline" && policy.confirm.pipelines.includes(String(a.pipeline ?? ""))) {
      return true;
    }
  }
  return false;
}
