// ==========================================
// COLLAB ROOT HELPER — A118 (HARDENED)
// Thin wrapper to bundle provider + reference hash channel.
// ==========================================

import type { CollabProviderAPI, CollabProviderOptions } from "./provider";
import { createCollabProvider } from "./provider";
import type { ReferenceHashAPI, ReferenceHashOptions } from "./reference_hash";
import { createReferenceHashChannel } from "./reference_hash";

export interface CollabRoot {
  provider: CollabProviderAPI;
  refHashes?: ReferenceHashAPI;
  destroy(): void;
}

export function createCollabRoot(opts: CollabProviderOptions & { refHashOpts?: Omit<ReferenceHashOptions, "stateMap" | "metaMap"> }): CollabRoot {
  const provider = createCollabProvider(opts);

  const refHashes = opts.refHashOpts
    ? createReferenceHashChannel({
        stateMap: provider.stateMap(),
        metaMap: provider.metaMap(),
        room: opts.room,
        docId: opts.docId,
        clientTag: opts.clientTag,
        conflictBus: opts.conflictBus,
        audit: opts.audit,
        publishMinIntervalMs: opts.refHashOpts.publishMinIntervalMs,
        mismatchDebounceMs: opts.refHashOpts.mismatchDebounceMs,
      })
    : undefined;

  return {
    provider,
    refHashes,
    destroy: () => {
      try {
        refHashes?.destroy();
      } catch {}
      try {
        provider.destroy();
      } catch {}
    },
  };
}
