// ==========================================
// CONFLICT CLASSIFIER HELPERS — A207 (HARDENED)
// FILE: uiux/advanced/conflicts/conflict_classifier.ts
// Converts known failure signals into conflict items (single source of truth).
// ==========================================

import type { ConflictKind, ConflictSeverity } from "./conflict_types";

export function classifyHashMismatch(input: {
  referencePeer: string;
  localHash: string;
  remoteHash: string;
}): {
  kind: ConflictKind;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  recommendedAction: "request_snapshot" | "set_reference_peer";
  payload: any;
  related: { stateHash: string };
} {
  return {
    kind: "hash_mismatch",
    severity: "critical",
    title: "Reference peer hash mismatch",
    detail: `Local stateHash != reference(${input.referencePeer}).`,
    recommendedAction: "request_snapshot",
    payload: input,
    related: { stateHash: input.remoteHash },
  };
}

export function classifyOpApplyFailed(input: { from: string; opHash?: string; error: string }): {
  kind: ConflictKind;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  recommendedAction: "inspect_op" | "request_snapshot";
  payload: any;
  related?: { opHash?: string };
} {
  return {
    kind: "op_apply_failed",
    severity: "warn",
    title: "Remote op failed to apply",
    detail: `Op rejected from ${input.from}: ${input.error}`,
    recommendedAction: "request_snapshot",
    payload: input,
    related: input.opHash ? { opHash: input.opHash } : undefined,
  };
}

export function classifySnapshotApplyFailed(input: { from: string; error: string }): {
  kind: ConflictKind;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  recommendedAction: "request_snapshot";
  payload: any;
} {
  return {
    kind: "snapshot_apply_failed",
    severity: "critical",
    title: "Snapshot failed to apply",
    detail: `Snapshot rejected from ${input.from}: ${input.error}`,
    recommendedAction: "request_snapshot",
    payload: input,
  };
}

export function classifySchemaMismatch(input: { from: string; localSchema: string; peerSchema: string }): {
  kind: ConflictKind;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  recommendedAction: "request_snapshot" | "none";
  payload: any;
} {
  return {
    kind: "schema_mismatch",
    severity: "warn",
    title: "Schema version mismatch",
    detail: `Local=${input.localSchema}, Peer(${input.from})=${input.peerSchema}`,
    recommendedAction: "none",
    payload: input,
  };
}

export function classifyTransportError(input: { error: string; where?: string }): {
  kind: ConflictKind;
  severity: ConflictSeverity;
  title: string;
  detail: string;
  recommendedAction: "none";
  payload: any;
} {
  return {
    kind: "transport_error",
    severity: "info",
    title: "Transport error",
    detail: input.where ? `${input.where}: ${input.error}` : input.error,
    recommendedAction: "none",
    payload: input,
  };
}
