// ==========================================
// CRDT COLLAB PROVIDER — A32 (HARDENED)
// One constructor to create CRDT client + presence manager with sane defaults.
// ==========================================

import type { UIStateAPI } from "../../nl/nl_crdt_bridge";
import { YjsCollabClient, type YjsCollabClientOptions } from "./client_yjs";
import { PresenceManager, type PresenceCallbacks, type PresenceUser } from "./awareness";

export interface CollabProviderOptions extends YjsCollabClientOptions {
  presence?: {
    user?: PresenceUser;
    callbacks?: PresenceCallbacks;
  };
}

export class CollabProvider {
  readonly crdt: YjsCollabClient;
  readonly presence: PresenceManager;

  constructor(opts: CollabProviderOptions) {
    this.crdt = new YjsCollabClient(opts);
    this.presence = new PresenceManager(this.crdt.provider, opts.presence?.callbacks);
    if (opts.presence?.user) this.presence.setUser(opts.presence.user);
  }

  bindUI(ui: UIStateAPI, allowedPrefixes: string[]): void {
    this.crdt.bindToUI(ui, allowedPrefixes);
  }

  destroy(): void {
    try {
      this.crdt.destroy();
    } catch {}
  }
}
