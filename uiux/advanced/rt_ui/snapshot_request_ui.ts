// ==========================================
// SNAPSHOT REQUEST HELPER — A240 (HARDENED)
// FILE: uiux/advanced/rt_ui/snapshot_request_ui.ts
// Small helper the UI can call to request a snapshot from a peer.
// Tries conflict adapter first, then NL router fallback.
// ==========================================

import type { ConflictUIAdapter } from "../conflicts_ui/conflict_ui_types";
import type { NLCommandRouter } from "../nl/nl_router";

export async function requestSnapshotFromUI(opts: {
  adapter?: ConflictUIAdapter;
  nl?: NLCommandRouter;
  nlCtx?: any;
  peer: string;
  reason?: string;
}): Promise<void> {
  const peer = opts.peer;

  if (opts.adapter?.requestSnapshot) {
    await opts.adapter.requestSnapshot(peer, opts.reason);
    return;
  }

  if (opts.nl) {
    // NL route: use deterministic command id if available
    const res = await opts.nl.exec(`/request_snapshot peer=${peer}`, { ...(opts.nlCtx ?? {}), clientTag: opts.nlCtx?.clientTag ?? "ui" });
    if (!res.ok) throw new Error(res.message ?? "snapshot request failed");
    return;
  }

  throw new Error("no snapshot request handler configured");
}
