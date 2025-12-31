// ==========================================
// REAL-TIME COLLAB CORE (CRDT WIRING) — A114 (HARDENED)
// Yjs doc + websocket provider + migration hook + awareness baseline.
// ==========================================

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import type { ConflictBus } from "../conflict/conflict_bus";
import type { AuditLogger } from "../audit/audit_logger";
import { migrateDocOnConnect } from "./migrate/migrate_on_connect";
import type { MigrationPlan } from "./migrate/migration_types";

export interface CollabProviderOptions {
  wsUrl: string; // e.g. wss://your-collab-host
  room: string;
  docId: string;
  clientTag: string;

  rootKey?: string; // default "state"
  metaKey?: string; // default "meta"

  migrationPlan?: MigrationPlan;
  conflictBus?: ConflictBus;
  audit?: AuditLogger;

  connect?: boolean; // default true
  disableBc?: boolean; // default true
}

export interface CollabProviderAPI {
  doc: Y.Doc;
  provider: WebsocketProvider;
  room: string;
  docId: string;
  clientTag: string;
  rootKey: string;
  metaKey: string;
  connect(): void;
  disconnect(): void;
  destroy(): void;
  stateMap(): Y.Map<any>;
  metaMap(): Y.Map<any>;
  awareness: any;
}

export function createCollabProvider(opts: CollabProviderOptions): CollabProviderAPI {
  const rootKey = opts.rootKey ?? "state";
  const metaKey = opts.metaKey ?? "meta";

  const doc = new Y.Doc();
  const roomName = `${opts.room}:${opts.docId}`;
  const provider = new WebsocketProvider(opts.wsUrl, roomName, doc, {
    connect: opts.connect ?? true,
    disableBc: opts.disableBc ?? true,
  });

  provider.awareness.setLocalStateField("user", {
    clientTag: opts.clientTag,
    lastSeenMs: Date.now(),
  });

  provider.on("status", async (e: any) => {
    await opts.audit?.log("collab.status", true, {
      room: opts.room,
      docId: opts.docId,
      clientTag: opts.clientTag,
      status: e?.status ?? null,
    });
  });

  provider.on("sync", async (isSynced: boolean) => {
    if (!isSynced) return;

    await opts.audit?.log("collab.synced", true, {
      room: opts.room,
      docId: opts.docId,
      clientTag: opts.clientTag,
    });

    if (opts.migrationPlan) {
      await migrateDocOnConnect({
        doc,
        rootKey,
        room: opts.room,
        docId: opts.docId,
        clientTag: opts.clientTag,
        plan: opts.migrationPlan,
        audit: opts.audit,
        conflictBus: opts.conflictBus,
      });
    }
  });

  function stateMap(): Y.Map<any> {
    return doc.getMap(rootKey);
  }

  function metaMap(): Y.Map<any> {
    return doc.getMap(metaKey);
  }

  function connect() {
    provider.connect();
  }

  function disconnect() {
    provider.disconnect();
  }

  function destroy() {
    try {
      provider.disconnect();
    } catch {}
    try {
      provider.destroy();
    } catch {}
    try {
      doc.destroy();
    } catch {}
  }

  return {
    doc,
    provider,
    room: opts.room,
    docId: opts.docId,
    clientTag: opts.clientTag,
    rootKey,
    metaKey,
    connect,
    disconnect,
    destroy,
    stateMap,
    metaMap,
    awareness: provider.awareness,
  };
}
