// ==========================================
// PERIODIC DIVERGENCE CHECK — A46 (HARDENED)
// Simple reference hash exchange via CRDT (Yjs meta map).
// Each client publishes its current UI-state hash; any client can select a peer as reference.
// ==========================================

import type * as Y from "yjs";
import { sha256Hex } from "../audit/hash";

function stableStringify(x: any): string {
  return JSON.stringify(sortRec(x));
}
function sortRec(x: any): any {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortRec);
  const keys = Object.keys(x).sort();
  const out: any = {};
  for (const k of keys) out[k] = sortRec(x[k]);
  return out;
}

export interface HashChannelOptions {
  meta: Y.Map<any>;                  // getYRoot(doc).meta
  clientTag: string;                 // stable per client (uuid)
  getLocalState: () => any;
  publishIntervalMs?: number;        // default 5000
  keyPrefix?: string;                // default "uihash:"
}

export class ReferenceHashChannel {
  private opts: Required<HashChannelOptions>;
  private timer: any = null;

  constructor(opts: HashChannelOptions) {
    this.opts = {
      publishIntervalMs: 5000,
      keyPrefix: "uihash:",
      ...opts,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.publish(), this.opts.publishIntervalMs);
    this.publish();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async publish(): Promise<void> {
    const stable = stableStringify(this.opts.getLocalState() ?? {});
    const h = await sha256Hex(stable);
    this.opts.meta.set(`${this.opts.keyPrefix}${this.opts.clientTag}`, {
      hash: h,
      ts: Date.now(),
    });
  }

  listPeers(): Array<{ clientTag: string; hash: string; ts: number }> {
    const out: Array<{ clientTag: string; hash: string; ts: number }> = [];
    this.opts.meta.forEach((v: any, k: string) => {
      if (!k.startsWith(this.opts.keyPrefix)) return;
      const clientTag = k.slice(this.opts.keyPrefix.length);
      out.push({ clientTag, hash: v?.hash ?? "", ts: v?.ts ?? 0 });
    });
    return out.sort((a, b) => b.ts - a.ts);
  }

  async getHashForPeer(clientTag: string): Promise<string | null> {
    const v = this.opts.meta.get(`${this.opts.keyPrefix}${clientTag}`);
    if (!v || typeof v !== "object") return null;
    return String(v.hash ?? "") || null;
  }
}
