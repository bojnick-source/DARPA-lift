// ==========================================
// CONFLICT GLUE (RT + CRDT + AUDIT) — A208 (HARDENED)
// FILE: uiux/advanced/conflicts/conflict_glue.ts
// Hooks RT mismatch + CRDT failures into ConflictStore.
// ==========================================

import type { RTMsg } from "../rt/protocol";
import type { CRDTProvider } from "../crdt/crdt_types";
import type { AuditLogger } from "../audit/audit_logger";
import type { ConflictStore } from "./conflict_store";

import {
  classifyHashMismatch,
  classifyOpApplyFailed,
  classifySchemaMismatch,
  classifySnapshotApplyFailed,
  classifyTransportError,
} from "./conflict_classifier";

export function bindConflicts<State>(opts: {
  conflicts: ConflictStore;
  audit?: AuditLogger;
  crdt: CRDTProvider<State>;

  // call when store changes
  onUpdated?: () => void;
}) {
  async function addAndAudit(kind: string, ok: boolean, payload: any) {
    if (!opts.audit) return;
    await opts.audit.log("conflict", kind, ok, payload);
  }

  // call this from RT onMessage path (after validate)
  async function onRTMsg(msg: RTMsg) {
    if (msg.kind === "mismatch") {
      const m: any = msg;
      const c = classifyHashMismatch({
        referencePeer: m.referencePeer ?? "unknown",
        localHash: m.localHash,
        remoteHash: m.remoteHash,
      });

      await opts.conflicts.add({
        severity: c.severity,
        kind: c.kind,
        title: c.title,
        detail: c.detail,
        sourcePeer: msg.from,
        payload: c.payload,
        related: { ...(c.related ?? {}), messageId: msg.id },
        recommendedAction: c.recommendedAction,
      });

      await addAndAudit("hash_mismatch", true, { from: msg.from, messageId: msg.id });
      opts.onUpdated?.();
      return;
    }

    if (msg.kind === "hello" || msg.kind === "presence" || msg.kind === "hash_publish") {
      const peerMeta = (msg as any).meta;
      if (!peerMeta?.schemaVersion) return;

      const localMeta = await opts.crdt.getMeta();
      if (peerMeta.schemaVersion !== localMeta.schemaVersion) {
        const c = classifySchemaMismatch({
          from: msg.from,
          localSchema: localMeta.schemaVersion,
          peerSchema: peerMeta.schemaVersion,
        });

        await opts.conflicts.add({
          severity: c.severity,
          kind: c.kind,
          title: c.title,
          detail: c.detail,
          sourcePeer: msg.from,
          payload: c.payload,
          related: { messageId: msg.id },
          recommendedAction: c.recommendedAction,
        });

        await addAndAudit("schema_mismatch", true, { from: msg.from, messageId: msg.id });
        opts.onUpdated?.();
      }
    }
  }

  // call these from the locations where you catch failures
  async function onOpApplyFailed(input: { from: string; opHash?: string; error: string; auditId?: string }) {
    const c = classifyOpApplyFailed(input);

    await opts.conflicts.add({
      severity: c.severity,
      kind: c.kind,
      title: c.title,
      detail: c.detail,
      sourcePeer: input.from,
      payload: c.payload,
      related: { ...(c.related ?? {}), auditId: input.auditId },
      recommendedAction: c.recommendedAction,
    });

    await addAndAudit("op_apply_failed", true, input);
    opts.onUpdated?.();
  }

  async function onSnapshotApplyFailed(input: { from: string; error: string; auditId?: string }) {
    const c = classifySnapshotApplyFailed(input);

    await opts.conflicts.add({
      severity: c.severity,
      kind: c.kind,
      title: c.title,
      detail: c.detail,
      sourcePeer: input.from,
      payload: c.payload,
      related: { auditId: input.auditId },
      recommendedAction: c.recommendedAction,
    });

    await addAndAudit("snapshot_apply_failed", true, input);
    opts.onUpdated?.();
  }

  async function onTransportError(input: { error: string; where?: string }) {
    const c = classifyTransportError(input);

    await opts.conflicts.add({
      severity: c.severity,
      kind: c.kind,
      title: c.title,
      detail: c.detail,
      payload: c.payload,
      recommendedAction: c.recommendedAction,
    });

    await addAndAudit("transport_error", true, input);
    opts.onUpdated?.();
  }

  return { onRTMsg, onOpApplyFailed, onSnapshotApplyFailed, onTransportError };
}
