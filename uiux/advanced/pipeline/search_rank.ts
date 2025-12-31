// ==========================================
// CMA-ES / SEARCH RANKING HOOK — A104 (HARDENED)
// Applies gates, then returns ranked list for optimizer consumption.
// ==========================================

import type { RobustnessGatesPolicy } from "../policy/robustness_gates";
import type { AuditLogger, Candidate, GateEnforcementConfig } from "./gates_integration";
import { applyRobustnessGatesToCandidates } from "./gates_integration";

export async function rankCandidatesWithGates(opts: {
  policy: RobustnessGatesPolicy;
  candidates: Candidate[];
  gateConfig?: Partial<GateEnforcementConfig>;
  audit?: AuditLogger;
  auditContext?: { runId?: string; stage?: string };
}): Promise<{ ok: boolean; ranked: Candidate[]; dropped: Candidate[] }> {
  const out = await applyRobustnessGatesToCandidates({
    policy: opts.policy,
    candidates: opts.candidates,
    config: opts.gateConfig,
    audit: opts.audit,
    auditContext: opts.auditContext,
  });

  if (!out.ok) return { ok: false, ranked: opts.candidates, dropped: [] };

  const ranked = [...out.kept].sort((a, b) => b.score - a.score);
  return { ok: true, ranked, dropped: out.dropped };
}
