// ==========================================
// CRDT MIGRATION HOOK — A88 (HARDENED)
// Run migrations when connecting to a document.
// ==========================================

import type * as Y from "yjs";
import type { AuditLogger } from "../../audit/audit_logger";
import type { ConflictBus } from "../../conflict/conflict_bus";
import type { ConflictEvent } from "../../conflict/conflict_types";
import { migrateState, getSchemaVersion } from "./migration_engine";
import type { MigrationPlan } from "./migration_types";

export async function migrateDocOnConnect(opts: {
  doc: Y.Doc;
  rootKey?: string; // default "state"
  room: string;
  docId: string;
  clientTag: string;
  plan: MigrationPlan;
  audit?: AuditLogger;
  conflictBus?: ConflictBus;
}): Promise<void> {
  const rootKey = opts.rootKey ?? "state";
  const map = opts.doc.getMap(rootKey);
  const snap = map.toJSON();
  const current = getSchemaVersion(snap);

  if (current === opts.plan.latestVersion) return;

  // warn
  opts.conflictBus?.emit({
    v: 1,
    id: `version_mismatch:${opts.room}:${opts.docId}:${current}->${opts.plan.latestVersion}`,
    tsMs: Date.now(),
    severity: "warn",
    kind: "transport",
    room: opts.room,
    docId: opts.docId,
    detail: {
      message: `Schema version mismatch: doc v${current}, client expects v${opts.plan.latestVersion}. Migrating…`,
    },
  } as ConflictEvent);

  await opts.audit?.log("pipeline.start", true, {
    type: "crdt_migration",
    from: current,
    to: opts.plan.latestVersion,
    room: opts.room,
    docId: opts.docId,
  });

  const out = migrateState(snap, opts.plan, {
    room: opts.room,
    docId: opts.docId,
    clientTag: opts.clientTag,
    nowMs: Date.now(),
  });

  if (!out.ok) {
    await opts.audit?.log("pipeline.fail", false, {
      type: "crdt_migration",
      reason: out.reason,
      room: opts.room,
      docId: opts.docId,
    });
    opts.conflictBus?.emit({
      v: 1,
      id: `migration_failed:${opts.room}:${opts.docId}`,
      tsMs: Date.now(),
      severity: "error",
      kind: "transport",
      room: opts.room,
      docId: opts.docId,
      detail: { message: `Migration failed: ${out.reason}` },
    } as ConflictEvent);
    return;
  }

  // Write migrated state back
  opts.doc.transact(() => {
    Array.from(map.keys()).forEach((k) => map.delete(k));
    for (const [k, v] of Object.entries(out.migratedState ?? {})) map.set(k, v as any);
  });

  await opts.audit?.log("pipeline.ok", true, {
    type: "crdt_migration",
    from: current,
    to: opts.plan.latestVersion,
    steps: out.appliedSteps ?? 0,
    room: opts.room,
    docId: opts.docId,
  });

  opts.conflictBus?.emit({
    v: 1,
    id: `migration_ok:${opts.room}:${opts.docId}:${current}->${opts.plan.latestVersion}`,
    tsMs: Date.now(),
    severity: "info",
    kind: "transport",
    room: opts.room,
    docId: opts.docId,
    detail: { message: `Migration complete: v${current} → v${opts.plan.latestVersion}.` },
  } as ConflictEvent);
}
