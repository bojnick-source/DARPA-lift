// ==========================================
// REFERENCE HASH CHANNEL — A116 (HARDENED)
// Publishes local hash and checks against a selected reference peer.
// ==========================================

import type * as Y from "yjs";
import type { ConflictBus } from "../conflict/conflict_bus";
import type { AuditLogger } from "../audit/audit_logger";
import { ymapToJSON, hashSnapshot, getReferenceHashFromMeta, getLocalHashFromMeta } from "./snapshot";

export interface ReferenceHashOptions {
  stateMap: Y.Map<any>;
  metaMap: Y.Map<any>;
  room: string;
  docId: string;
  clientTag: string;
  conflictBus?: ConflictBus;
  audit?: AuditLogger;
  publishMinIntervalMs?: number; // default 750
  mismatchDebounceMs?: number; // default 350
}

export interface ReferenceHashAPI {
  forcePublish(): Promise<void>;
  setReferencePeer(clientTag: string | null): void;
  getReferenceHash(): string | null;
  getLocalHash(): string | null;
  destroy(): void;
}

export function createReferenceHashChannel(opts: ReferenceHashOptions): ReferenceHashAPI {
  const publishMinIntervalMs = opts.publishMinIntervalMs ?? 750;
  const mismatchDebounceMs = opts.mismatchDebounceMs ?? 350;

  let lastPublishMs = 0;
  let mismatchTimer: any = null;

  function metaJSON(): any {
    return ymapToJSON(opts.metaMap);
  }

  function ensureMetaContainers() {
    opts.metaMap.set("hashes", opts.metaMap.get("hashes") ?? {});
    opts.metaMap.set("reference", opts.metaMap.get("reference") ?? {});
  }

  async function publishNow() {
    const now = Date.now();
    if (now - lastPublishMs < publishMinIntervalMs) return;

    ensureMetaContainers();

    const snap = ymapToJSON(opts.stateMap);
    const h = await hashSnapshot(snap);

    const hashes = structuredClone(opts.metaMap.get("hashes") ?? {});
    hashes[opts.clientTag] = { hash: h, tsMs: now };

    opts.metaMap.set("hashes", hashes);
    lastPublishMs = now;

    await opts.audit?.log("crdt.hash_publish", true, {
      room: opts.room,
      docId: opts.docId,
      clientTag: opts.clientTag,
      hash: h,
    });
  }

  function setReferencePeer(clientTag: string | null) {
    ensureMetaContainers();
    const ref = structuredClone(opts.metaMap.get("reference") ?? {});
    if (!clientTag) delete ref.clientTag;
    else ref.clientTag = clientTag;
    opts.metaMap.set("reference", ref);

    void opts.audit?.log("crdt.ref_peer_set", true, {
      room: opts.room,
      docId: opts.docId,
      clientTag: opts.clientTag,
      referencePeer: clientTag,
    });
  }

  function getReferenceHash(): string | null {
    const m = metaJSON();
    return getReferenceHashFromMeta(m);
  }

  function getLocalHash(): string | null {
    const m = metaJSON();
    return getLocalHashFromMeta(m, opts.clientTag);
  }

  function scheduleMismatchCheck() {
    clearTimeout(mismatchTimer);
    mismatchTimer = setTimeout(() => {
      const m = metaJSON();
      const refHash = getReferenceHashFromMeta(m);
      const localHash = getLocalHashFromMeta(m, opts.clientTag);
      if (!refHash || !localHash) return;
      if (refHash !== localHash) {
        opts.conflictBus?.emit({
          v: 1,
          id: `hash_mismatch:${opts.room}:${opts.docId}:${opts.clientTag}`,
          tsMs: Date.now(),
          severity: "warn",
          kind: "hash_mismatch",
          room: opts.room,
          docId: opts.docId,
          peer: { clientTag: m?.reference?.clientTag ?? "unknown" },
          detail: {
            message: "Local state hash differs from reference peer.",
            localHash,
            refHash,
          },
        } as any);
      }
    }, mismatchDebounceMs);
  }

  const stateObs = () => {
    void publishNow().then(() => scheduleMismatchCheck());
  };
  const metaObs = () => scheduleMismatchCheck();

  opts.stateMap.observeDeep(stateObs);
  opts.metaMap.observe(metaObs);

  void publishNow();

  return {
    forcePublish: async () => {
      lastPublishMs = 0;
      await publishNow();
      scheduleMismatchCheck();
    },
    setReferencePeer,
    getReferenceHash,
    getLocalHash,
    destroy: () => {
      try {
        opts.stateMap.unobserveDeep(stateObs);
      } catch {}
      try {
        opts.metaMap.unobserve(metaObs);
      } catch {}
      clearTimeout(mismatchTimer);
    },
  };
}
