// ==========================================
// CRDT MIGRATIONS (EXAMPLE) — A87 (HARDENED)
// LatestVersion=1 means: v0 -> v1 exists.
// ==========================================

import type { MigrationPlan, MigrationContext, MigrationResult } from "./migration_types";

function migrate_v0_to_v1(state: any, _ctx: MigrationContext): MigrationResult {
  // Example:
  // - rename "opt.pop" -> "opt.popsize"
  // - ensure "ui.panels" exists
  const s = structuredClone(state ?? {});
  if (s?.opt?.pop !== undefined && s?.opt?.popsize === undefined) {
    s.opt.popsize = s.opt.pop;
    delete s.opt.pop;
  }
  if (!s.ui) s.ui = {};
  if (!s.ui.panels) s.ui.panels = {};
  return { ok: true, fromVersion: 0, toVersion: 1, changed: true };
}

export const PLAN_V1: MigrationPlan = {
  latestVersion: 1,
  migrations: {
    0: migrate_v0_to_v1,
  },
};
