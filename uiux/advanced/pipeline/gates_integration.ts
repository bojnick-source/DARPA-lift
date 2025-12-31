// ==========================================
// PIPELINE INTEGRATION (ROBUSTNESS GATES) — A102 (HARDENED)
// Integrates policy.robustness_gates into selection/ranking.
// ==========================================

import type { RobustnessGatesPolicy } from "../policy/robustness_gates";
import { checkGates, validateRobustnessGates } from "../policy/robustness_gates";

export interface AuditLogger {
  log(event: string, ok: boolean, payload?: any): Promise<void> | void;
}

export type GateEnforcementMode = "reject" | "penalize";

export interface GateEnforcementConfig {
  mode: GateEnforcementMode;

  // Penalize mode:
  // penaltyPerFailure is subtracted from score (or added, depending on objective direction)
  penaltyPerFailure: number;

  // If objective is "higher is better": score' = score - penalty
  // If objective is "lower is better": score' = score + penalty
  objectiveDirection: "higher_is_better" | "lower_is_better";

  // Optional: count NaN missing metrics as failures (default true)
  missingIsFailure: boolean;
}

export const DEFAULT_GATE_ENFORCEMENT: GateEnforcementConfig = {
  mode: "reject",
  penaltyPerFailure: 1e6,
  objectiveDirection: "higher_is_better",
  missingIsFailure: true,
};

export interface Candidate {
  id: string;
  // aggregated metrics, including tagged keys:
  //  e.g. { "unsafe_contact_rate": 0.01, "temp_max_c.cvar95_upper": 84, "specific_power_w_per_kg.q10": 310 }
  metrics: Record<string, number>;
  // objective score used for ranking (already computed by your optimizer)
  score: number;
  meta?: Record<string, any>;
}

export interface GateEvalResult {
  candidateId: string;
  ok: boolean;
  scoreBefore: number;
  scoreAfter: number;
  failed: Array<{ metric: string; got: number; need: string }>;
}

export interface ApplyGatesOutput {
  ok: boolean;
  issues?: Array<{ path: string; message: string }>;
  policyEnabled: boolean;
  kept: Candidate[];
  dropped: Candidate[];
  evaluations: GateEvalResult[];
}

function penaltyForFailures(n: number, cfg: GateEnforcementConfig): number {
  if (n <= 0) return 0;
  return cfg.penaltyPerFailure * n;
}

function applyPenalty(score: number, penalty: number, dir: GateEnforcementConfig["objectiveDirection"]): number {
  if (penalty <= 0) return score;
  return dir === "higher_is_better" ? score - penalty : score + penalty;
}

export async function applyRobustnessGatesToCandidates(opts: {
  policy: RobustnessGatesPolicy;
  candidates: Candidate[];
  config?: Partial<GateEnforcementConfig>;
  audit?: AuditLogger;
  auditContext?: { runId?: string; stage?: string };
}): Promise<ApplyGatesOutput> {
  const cfg: GateEnforcementConfig = { ...DEFAULT_GATE_ENFORCEMENT, ...(opts.config ?? {}) };

  const issues = validateRobustnessGates(opts.policy);
  if (issues.length) {
    await opts.audit?.log("policy.invalid", false, {
      type: "robustness_gates",
      issues,
      ctx: opts.auditContext ?? null,
    });
    return {
      ok: false,
      issues,
      policyEnabled: false,
      kept: opts.candidates,
      dropped: [],
      evaluations: [],
    };
  }

  if (!opts.policy.enabled) {
    await opts.audit?.log("policy.disabled", true, {
      type: "robustness_gates",
      ctx: opts.auditContext ?? null,
    });
    return {
      ok: true,
      policyEnabled: false,
      kept: opts.candidates,
      dropped: [],
      evaluations: [],
    };
  }

  const kept: Candidate[] = [];
  const dropped: Candidate[] = [];
  const evaluations: GateEvalResult[] = [];

  for (const c of opts.candidates) {
    // Optionally treat missing metrics as failures:
    // checkGates already fails missing as NaN; we keep that behavior and allow config override.
    const r = checkGates(opts.policy, c.metrics);

    let ok = r.ok;
    let failures = r.failed;

    if (!cfg.missingIsFailure) {
      // remove failures where got is NaN (missing metric)
      const filtered = failures.filter((f) => Number.isFinite(f.got));
      failures = filtered;
      ok = opts.policy.requireAll ? filtered.length === 0 : true;
    }

    const penalty = cfg.mode === "penalize" ? penaltyForFailures(failures.length, cfg) : 0;
    const scoreAfter = applyPenalty(c.score, penalty, cfg.objectiveDirection);

    evaluations.push({
      candidateId: c.id,
      ok,
      scoreBefore: c.score,
      scoreAfter,
      failed: failures,
    });

    if (cfg.mode === "reject") {
      if (ok) kept.push(c);
      else dropped.push(c);
    } else {
      // penalize: keep but overwrite score for downstream ranking
      kept.push({ ...c, score: scoreAfter });
    }

    if (!ok) {
      await opts.audit?.log("policy.gate_fail", false, {
        type: "robustness_gates",
        candidateId: c.id,
        failures: failures.slice(0, 12),
        failuresCount: failures.length,
        scoreBefore: c.score,
        scoreAfter,
        mode: cfg.mode,
        ctx: opts.auditContext ?? null,
      });
    }
  }

  await opts.audit?.log("policy.gates_applied", true, {
    type: "robustness_gates",
    mode: cfg.mode,
    total: opts.candidates.length,
    kept: kept.length,
    dropped: dropped.length,
    ctx: opts.auditContext ?? null,
  });

  return { ok: true, policyEnabled: true, kept, dropped, evaluations };
}
