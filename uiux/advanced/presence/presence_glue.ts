// ==========================================
// PRESENCE GLUE (SyncManager -> PresenceStore) — A188 (HARDENED)
// FILE: uiux/advanced/presence/presence_glue.ts
// Binds RT messages into PresenceStore + PingTracker.
// ==========================================

import type { PresenceStore } from "./presence_store";
import type { RTMsg } from "../rt/protocol";
import type { PingTracker } from "./ping_tracker";

export function bindPresence(opts: {
  presence: PresenceStore;
  ping: PingTracker;
  onPresenceUpdated?: () => void;
}) {
  function handle(msg: RTMsg) {
    // pong -> ping tracker
    opts.ping.onMsg(msg);

    if (msg.kind === "presence") {
      const m: any = msg;
      opts.presence.setPeerStatus(msg.from, m.status, m.meta?.atMs ?? msg.atMs);
      if (m.meta?.stateHash && m.meta?.schemaVersion) {
        opts.presence.setPeerMeta(msg.from, {
          stateHash: m.meta.stateHash,
          schemaVersion: m.meta.schemaVersion,
          atMs: m.meta.atMs ?? msg.atMs,
        });
      }
      opts.onPresenceUpdated?.();
      return;
    }

    if (msg.kind === "hello") {
      const m: any = msg;
      opts.presence.setPeerStatus(msg.from, "online", m.meta?.atMs ?? msg.atMs);
      if (m.meta?.stateHash && m.meta?.schemaVersion) {
        opts.presence.setPeerMeta(msg.from, {
          stateHash: m.meta.stateHash,
          schemaVersion: m.meta.schemaVersion,
          atMs: m.meta.atMs ?? msg.atMs,
        });
      }
      opts.onPresenceUpdated?.();
      return;
    }

    if (msg.kind === "hash_publish") {
      const m: any = msg;
      if (m.meta?.stateHash && m.meta?.schemaVersion) {
        opts.presence.setPeerMeta(msg.from, {
          stateHash: m.meta.stateHash,
          schemaVersion: m.meta.schemaVersion,
          atMs: m.meta.atMs ?? msg.atMs,
        });
        opts.onPresenceUpdated?.();
      }
      return;
    }
  }

  return { handle };
}
