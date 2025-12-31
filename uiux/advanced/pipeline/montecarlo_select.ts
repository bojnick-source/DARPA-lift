// ==========================================
// MONTE CARLO SELECTION HELPER — A103 (HARDENED)
// Picks best candidate by score after applying gates.
// ==========================================

import type { RobustnessGatesPolicy } from "../policy/robustness_gates";
import type { AuditLogger, Candidate, GateEnforcementConfig } from "./gates_integration";
import { applyRobustnessGatesToCandidates } from "./gates_integration";

export interface SelectBestOutput {
  ok: boolean;
  best?: Candidate;
  kept: Candidate[];
  dropped: Candidate[];
  note?: string;
}

export async function selectBestAfterGates(opts: {
  policy: RobustnessGatesPolicy;
  candidates: Candidate[];
  gateConfig?: Partial<GateEnforcementConfig>;
  audit?: AuditLogger;
  auditContext?: { runId?: string; stage?: string };
}): Promise<SelectBestOutput> {
  const out = await applyRobustnessGatesToCandidates({
    policy: opts.policy,
    candidates: opts.candidates,
    config: opts.gateConfig,
    audit: opts.audit,
    auditContext: opts.auditContext,
  });

  if (!out.ok) return { ok: false, kept: opts.candidates, dropped: [], note: "Invalid policy" };

  if (!out.kept.length) {
    await opts.audit?.log("selection.empty", false, {
      reason: "all_candidates_failed_gates",
      total: opts.candidates.length,
      ctx: opts.auditContext ?? null,
    });
    return { ok: false, kept: [], dropped: out.dropped, note: "All candidates failed gates" };
  }

  // higher score is better by convention here; if you use lower-is-better, invert before calling.
  const best = [...out.kept].sort((a, b) => b.score - a.score)[0];

  await opts.audit?.log("selection.best", true, {
    bestId: best.id,
    bestScore: best.score,
    kept: out.kept.length,
    dropped: out.dropped.length,
    ctx: opts.auditContext ?? null,
  });

  return { ok: true, best, kept: out.kept, dropped: out.dropped };
}
