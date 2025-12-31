// ==========================================
// CRDT MIGRATION ENGINE — A86 (HARDENED)
// Applies stepwise migrations: v -> v+1 -> ... -> latest.
// ==========================================

import type { MigrationPlan, MigrationContext, MigrationResult, MigrationFn } from "./migration_types";

export interface MigrationEngineOutput {
  ok: boolean;
  result?: MigrationResult;
  migratedState?: any;
  appliedSteps?: number;
  reason?: string;
}

export function getSchemaVersion(state: any): number {
  const v = state?.schema_version;
  const n = typeof v === "number" ? v : parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function setSchemaVersion(state: any, v: number): any {
  const next = structuredClone(state ?? {});
  next.schema_version = v;
  return next;
}

export function migrateState(
  state: any,
  plan: MigrationPlan,
  ctxBase: Omit<MigrationContext, "fromVersion" | "toVersion">
): MigrationEngineOutput {
  const current = getSchemaVersion(state);
  const latest = plan.latestVersion;

  if (current > latest) {
    return { ok: false, reason: `STATE_NEWER_THAN_CLIENT:${current}>${latest}` };
  }
  if (current === latest) {
    return {
      ok: true,
      result: { ok: true, fromVersion: current, toVersion: latest, changed: false },
      migratedState: state,
      appliedSteps: 0,
    };
  }

  let s = structuredClone(state ?? {});
  let steps = 0;

  for (let v = current; v < latest; v++) {
    const fn: MigrationFn | undefined = plan.migrations[v];
    if (!fn) return { ok: false, reason: `MISSING_MIGRATION_STEP:v${v}->v${v + 1}` };

    const ctx: MigrationContext = {
      ...ctxBase,
      fromVersion: v,
      toVersion: v + 1,
      nowMs: ctxBase.nowMs,
    };

    const r = fn(s, ctx);
    if (!r.ok) return { ok: false, reason: r.note ?? `MIGRATION_FAILED:v${v}->v${v + 1}` };

    // Enforce write of version for each step (prevents partial drift)
    s = setSchemaVersion(s, v + 1);
    steps++;
  }

  return {
    ok: true,
    result: { ok: true, fromVersion: current, toVersion: latest, changed: true },
    migratedState: s,
    appliedSteps: steps,
  };
}
