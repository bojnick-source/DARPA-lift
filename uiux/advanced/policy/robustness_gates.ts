// ==========================================
// ROBUSTNESS GATES POLICY — A99 (HARDENED)
// Stores robustness gates as POLICY (not hard-coded into pipelines).
// ==========================================

export type QuantileTag =
  | "q10"   // 10th percentile (worst-case-ish for "higher is better")
  | "q90"   // 90th percentile (high tail for "lower is better")
  | "cvar95_upper"; // CVaR upper 95% tail (risk-averse upper tail)

export interface Gate {
  enabled: boolean;
  op: "<=" | ">=";
  value: number;
  metric: string;
  tag?: QuantileTag;
  unit?: string;
  note?: string;
}

export interface RobustnessGatesPolicy {
  v: 1;
  // Global policy toggles
  enabled: boolean;
  // If true: candidate must satisfy all enabled gates
  requireAll: boolean;
  // Gate list
  gates: Gate[];
}

export const DEFAULT_ROBUSTNESS_GATES: RobustnessGatesPolicy = {
  v: 1,
  enabled: true,
  requireAll: true,
  gates: [
    {
      enabled: true,
      metric: "unsafe_contact_rate",
      op: "<=",
      value: 0.02,
      unit: "fraction",
      note: "Unsafe contact events / total contacts",
    },
    {
      enabled: true,
      metric: "fall_over_rate",
      op: "<=",
      value: 0.01,
      unit: "fraction",
      note: "Falls / episodes",
    },
    {
      enabled: true,
      metric: "sim_error_rate",
      op: "<=",
      value: 0.0,
      unit: "fraction",
      note: "NaNs, solver blowups, or invalid state rate",
    },
    {
      enabled: true,
      metric: "temp_max_c",
      tag: "cvar95_upper",
      op: "<=",
      value: 90, // set your thermal cap
      unit: "°C",
      note: "CVaR upper 95% of peak temperature",
    },
    {
      enabled: true,
      metric: "landing_impulse",
      tag: "cvar95_upper",
      op: "<=",
      value: 1200, // set your structure limit
      unit: "N·s",
      note: "CVaR upper 95% of landing impulse",
    },
    {
      enabled: true,
      metric: "slip_rate",
      tag: "q90",
      op: "<=",
      value: 0.05,
      unit: "fraction",
      note: "90th percentile slip rate",
    },
    {
      enabled: true,
      metric: "specific_power_w_per_kg",
      tag: "q10",
      op: ">=",
      value: 250, // set your minimum worst-case acceptable
      unit: "W/kg",
      note: "10th percentile specific power must stay above minimum",
    },
  ],
};

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateRobustnessGates(p: RobustnessGatesPolicy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!p || typeof p !== "object") return [{ path: "(root)", message: "Policy must be an object" }];
  if (p.v !== 1) issues.push({ path: "v", message: "Unsupported policy version" });

  if (!Array.isArray(p.gates)) {
    issues.push({ path: "gates", message: "gates must be an array" });
    return issues;
  }

  p.gates.forEach((g, i) => {
    const base = `gates[${i}]`;
    if (typeof g.metric !== "string" || g.metric.trim() === "") issues.push({ path: `${base}.metric`, message: "metric required" });
    if (g.op !== "<=" && g.op !== ">=") issues.push({ path: `${base}.op`, message: "op must be <= or >=" });
    if (typeof g.value !== "number" || !Number.isFinite(g.value)) issues.push({ path: `${base}.value`, message: "value must be finite number" });
    if (typeof g.enabled !== "boolean") issues.push({ path: `${base}.enabled`, message: "enabled must be boolean" });
  });

  return issues;
}

// Helper for pipelines: apply gates to a metrics object (already aggregated w/ tags)
export function checkGates(
  policy: RobustnessGatesPolicy,
  metrics: Record<string, number>
): { ok: boolean; failed: Array<{ metric: string; got: number; need: string }> } {
  if (!policy.enabled) return { ok: true, failed: [] };

  const failed: Array<{ metric: string; got: number; need: string }> = [];

  for (const g of policy.gates) {
    if (!g.enabled) continue;

    const key = g.tag ? `${g.metric}.${g.tag}` : g.metric;
    const got = metrics[key];

    if (typeof got !== "number" || !Number.isFinite(got)) {
      failed.push({ metric: key, got: NaN, need: `${g.op} ${g.value}` });
      continue;
    }

    const pass = g.op === "<=" ? got <= g.value : got >= g.value;
    if (!pass) failed.push({ metric: key, got, need: `${g.op} ${g.value}` });
  }

  const ok = policy.requireAll ? failed.length === 0 : failed.length < policy.gates.filter((g) => g.enabled).length;
  return { ok, failed };
}
