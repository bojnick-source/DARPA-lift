// ==========================================
// SYNC HEALTH DERIVED EVAL — A243 (HARDENED)
// FILE: uiux/advanced/sync_health_ui/gate_eval.ts
// Deterministic evaluation of robustness gates against latest samples.
// ==========================================

import type { GateEval, GateMetricSample, RobustnessGate } from "./sync_health_ui_types";

export function evalGates(gates: RobustnessGate[], samples: GateMetricSample[]): GateEval[] {
  const latest = new Map<string, GateMetricSample>();

  // latest sample per metric
  for (const s of samples) {
    const cur = latest.get(s.metric);
    if (!cur || s.atMs > cur.atMs) latest.set(s.metric, s);
  }

  const out: GateEval[] = [];
  for (const g of gates) {
    const s = latest.get(g.metric);
    const v = s?.value;

    const ok =
      v == null
        ? false
        : g.comparator === "<="
          ? v <= g.threshold
          : v >= g.threshold;

    out.push({
      gateId: g.id,
      ok,
      value: v,
      threshold: g.threshold,
      comparator: g.comparator,
      metric: g.metric,
      note: v == null ? "no sample" : undefined,
    });
  }

  // stable order: failing first, then by metric
  out.sort((a, b) => Number(a.ok) - Number(b.ok) || a.metric.localeCompare(b.metric));
  return out;
}
