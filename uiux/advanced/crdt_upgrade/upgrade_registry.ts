// ==========================================
// MIGRATION REGISTRY — A218 (HARDENED)
// FILE: uiux/advanced/crdt_upgrade/upgrade_registry.ts
// ==========================================

import type { MigrationStep, UpgradePlan } from "./upgrade_types";
import { canonicalJSONStringify } from "../crdt/canonicalize";
import { sha256Hex } from "../crdt/hash";

export class MigrationRegistry<State = any> {
  private steps: MigrationStep<State>[] = [];

  register(step: MigrationStep<State>) {
    // Basic invariants
    if (!step.id || !step.from || !step.to) throw new Error("invalid migration step");
    this.steps.push(step);
  }

  list(): MigrationStep<State>[] {
    return [...this.steps].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.id.localeCompare(b.id));
  }

  // Find a linear path from from->to (simple BFS)
  findPlan(from: string, to: string): MigrationStep<State>[] | null {
    if (from === to) return [];

    const steps = this.list();
    const next = new Map<string, MigrationStep<State>[] >();

    // adjacency
    const adj = new Map<string, MigrationStep<State>[] >();
    for (const s of steps) {
      const arr = adj.get(s.from) ?? [];
      arr.push(s);
      adj.set(s.from, arr);
    }

    // BFS on versions
    const q: string[] = [from];
    const prev = new Map<string, { via: MigrationStep<State>; from: string }>();
    const seen = new Set<string>([from]);

    while (q.length) {
      const cur = q.shift()!;
      const outs = adj.get(cur) ?? [];
      for (const step of outs) {
        const nxt = step.to;
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        prev.set(nxt, { via: step, from: cur });
        if (nxt === to) {
          return unwind(prev, from, to);
        }
        q.push(nxt);
      }
    }
    return null;
  }

  async makePlan(from: string, to: string): Promise<UpgradePlan> {
    const steps = this.findPlan(from, to);
    if (!steps) throw new Error(`no migration path from ${from} to ${to}`);

    const planCore = {
      v: 1,
      from,
      to,
      steps: steps.map((s) => ({ id: s.id, from: s.from, to: s.to, description: s.description })),
    };

    const planId = `p_${(await sha256Hex(canonicalJSONStringify(planCore))).slice(0, 20)}`;

    return { ...planCore, planId };
  }

  // Apply a plan deterministically
  applyPlan(state: State, planSteps: MigrationStep<State>[]): { ok: boolean; state?: State; error?: string } {
    let cur = state;
    for (const step of planSteps) {
      try {
        cur = step.migrate(cur);
        const v = step.validate?.(cur);
        if (v && !v.ok) return { ok: false, error: v.error ?? `validation failed at ${step.id}` };
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    }
    return { ok: true, state: cur };
  }

  // resolve plan steps by id
  resolveSteps(plan: UpgradePlan): MigrationStep<State>[] {
    const byId = new Map(this.steps.map((s) => [s.id, s] as const));
    const resolved: MigrationStep<State>[] = [];
    for (const s of plan.steps) {
      const step = byId.get(s.id);
      if (!step) throw new Error(`missing migration step id=${s.id}`);
      if (step.from !== s.from || step.to !== s.to) throw new Error(`step mismatch id=${s.id}`);
      resolved.push(step);
    }
    return resolved;
  }
}

function unwind<State>(
  prev: Map<string, { via: MigrationStep<State>; from: string }>,
  start: string,
  end: string
): MigrationStep<State>[] {
  const out: MigrationStep<State>[] = [];
  let cur = end;
  while (cur !== start) {
    const p = prev.get(cur);
    if (!p) return [];
    out.push(p.via);
    cur = p.from;
  }
  out.reverse();
  return out;
}
