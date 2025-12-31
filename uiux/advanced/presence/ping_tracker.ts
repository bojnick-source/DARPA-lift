// ==========================================
// PRESENCE PING TRACKER — A187 (HARDENED)
// FILE: uiux/advanced/presence/ping_tracker.ts
// Uses RT protocol ping/pong to measure RTT.
// ==========================================

import type { RTTransport } from "../rt/transport";
import type { RTMsg } from "../rt/protocol";

function uid(): string {
  const r = Math.random().toString(16).slice(2);
  return `ping_${Date.now().toString(16)}_${r}`;
}

export class PingTracker {
  private t: RTTransport;
  private clientTag: string;
  private pending = new Map<string, { peer: string; atMs: number }>();

  onRTT?: (peer: string, rttMs: number) => void;

  constructor(opts: { transport: RTTransport; clientTag: string }) {
    this.t = opts.transport;
    this.clientTag = opts.clientTag;
  }

  async ping(peer: string): Promise<void> {
    const nonce = uid();
    this.pending.set(nonce, { peer, atMs: Date.now() });

    const msg: RTMsg = {
      v: 1,
      kind: "ping",
      from: this.clientTag,
      to: peer,
      id: uid(),
      atMs: Date.now(),
      nonce,
    } as any;

    await this.t.send(msg);
  }

  // call from your transport onMessage
  onMsg(msg: RTMsg) {
    if (msg.kind !== "pong") return;
    const nonce = (msg as any).nonce as string;
    const p = this.pending.get(nonce);
    if (!p) return;

    this.pending.delete(nonce);
    const rtt = Math.max(0, Date.now() - p.atMs);
    this.onRTT?.(p.peer, rtt);
  }
}
