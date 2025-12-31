// ==========================================
// CRDT UPGRADE (Yjs) — A26 (HARDENED)
// Yjs client that plugs into your existing UIStateAPI:
//  - setValue(path, value) writes into Yjs
//  - observer emits remote changes back to UI
// Offline persistence (optional): y-indexeddb
// Transport: y-websocket provider
// ==========================================

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import { getYRoot } from "./yjs_types";
import { setYByPath } from "./path_ops";
import { observeNestedMap, type PathEvent } from "./observe";

// Optional offline persistence:
// import { IndexeddbPersistence } from "y-indexeddb";

export interface YjsCollabClientOptions {
  url: string;      // e.g. "wss://your-host/ws"
  room: string;     // document id
  token?: string;   // optional auth token (server-enforced)
  connect?: boolean;
  maxStateBytes?: number; // defense: refuse huge local sets
  // enableIndexedDb?: boolean;
}

export interface UIStateAPI {
  setValue(path: string, value: any): void;
}

export class YjsCollabClient {
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider;

  private root = getYRoot(new Y.Doc()); // replaced in ctor
  private unsub: (() => void) | null = null;

  constructor(opts: YjsCollabClientOptions) {
    this.doc = new Y.Doc();
    this.root = getYRoot(this.doc);

    const params = new URLSearchParams();
    if (opts.token) params.set("token", opts.token);

    const url = params.toString() ? `${opts.url}?${params.toString()}` : opts.url;
    this.provider = new WebsocketProvider(url, opts.room, this.doc, { connect: opts.connect ?? true });

    // Optional:
    // if (opts.enableIndexedDb) new IndexeddbPersistence(opts.room, this.doc);

    // hard cap on awareness state size etc. left to server
  }

  bindToUI(ui: UIStateAPI, allowedPrefixes: string[] = []): void {
    // push remote changes into UI
    this.unsub = observeNestedMap(this.root.state, (e: PathEvent) => {
      if (e.type === "set") {
        if (typeof e.value === "string" && e.value === "(map)") return; // don't spam placeholder
        if (allowedPrefixes.length && !allowedPrefixes.some((p) => e.path.startsWith(p))) return;
        ui.setValue(e.path, e.value);
      }
      // deletes are optional; if your UI supports, implement ui.deleteValue
    });
  }

  unbind(): void {
    this.unsub?.();
    this.unsub = null;
  }

  setValue(path: string, value: any, maxBytes = 256_000): void {
    // defense: refuse massive payloads from UI layer
    const approx = (() => {
      try { return JSON.stringify(value).length; } catch { return 0; }
    })();
    if (approx > maxBytes) throw new Error(`Refusing setValue payload > ${maxBytes} bytes.`);

    this.doc.transact(() => {
      setYByPath(this.root.state, path, value);
    });
  }

  destroy(): void {
    this.unbind();
    try { this.provider.destroy(); } catch {}
    try { this.doc.destroy(); } catch {}
  }
}
