// ==========================================
// SYNC MANAGER (PRESENCE + OP BUS + SNAPSHOT SYNC) — A183 (HARDENED)
// FILE: uiux/advanced/rt/sync_manager.ts
// - Handles hello/presence
// - Broadcast ops
// - Snapshot request/response
// - Reference peer propagation
// - Emits mismatch events for SyncHealth
// ==========================================

import type { RTTransport } from "./transport";
import type { RTMsg, CRDTMeta } from "./protocol";
import { validateRTMsg } from "./protocol";

import type { CRDTProvider } from "../crdt/crdt_types";
import type { PeerHash, MismatchEvent } from "../sync/health_types";
import { MismatchBuffer } from "../sync/health_store";

function uid(): string {
  // deterministic enough for UI; replace with crypto.randomUUID() when available
  const r = Math.random().toString(16).slice(2);
  return `m_${Date.now().toString(16)}_${r}`;
}

export interface SyncManagerHooks<State> {
  transport: RTTransport;
  crdt: CRDTProvider<State>;

  // state paths (for UI layer)
  getReferencePeer: () => string | null;
  setReferencePeer: (peer: string | null) => void;

  // peer registry
  onPeersUpdated?: (peers: PeerHash[]) => void;

  // mismatch buffer for SyncHealth
  mismatchBuffer?: MismatchBuffer;

  // optional audit
  audit?: { log: (event: string, ok: boolean, payload?: any) => Promise<void> | void };
}

export class SyncManager<State> {
  private t: RTTransport;
  private crdt: CRDTProvider<State>;
  private hooks: SyncManagerHooks<State>;

  private peers = new Map<string, PeerHash>();
  private unsub?: () => void;

  private mismatchBuf: MismatchBuffer;

  // rate-limit op broadcast
  private lastOpMs = 0;
  private minOpIntervalMs = 5;

  constructor(h: SyncManagerHooks<State>) {
    this.hooks = h;
    this.t = h.transport;
    this.crdt = h.crdt;
    this.mismatchBuf = h.mismatchBuffer ?? new MismatchBuffer(100);
  }

  async start(): Promise<void> {
    await this.t.open();
    this.unsub = this.t.onMessage((m) => void this.onMsg(m));
    await this.sendHello();
    await this.sendPresence("online");
  }

  async stop(): Promise<void> {
    this.unsub?.();
    this.unsub = undefined;
    await this.sendPresence("offline");
    await this.t.close();
  }

  getPeers(): PeerHash[] {
    return [...this.peers.values()].sort((a, b) => a.clientTag.localeCompare(b.clientTag));
  }

  getMismatchEvents(): MismatchEvent[] {
    return this.mismatchBuf.list();
  }

  // -------- outgoing --------

  private async sendHello() {
    const meta = await this.crdt.getMeta();
    const msg: RTMsg = {
      v: 1,
      kind: "hello",
      from: this.crdt.getClientTag(),
      to: null,
      id: uid(),
      atMs: Date.now(),
      meta,
      caps: {
        provider: this.crdt.kind as any,
        supportsOps: true,
        supportsSnapshots: true,
      },
    } as any;

    await this.safeSend(msg);
  }

  async sendPresence(status: "online" | "away" | "offline") {
    const meta = await this.crdt.getMeta();
    const msg: RTMsg = {
      v: 1,
      kind: "presence",
      from: this.crdt.getClientTag(),
      to: null,
      id: uid(),
      atMs: Date.now(),
      status,
      meta,
    } as any;

    await this.safeSend(msg);
  }

  async publishHash() {
    const meta = await this.crdt.getMeta();
    const msg: RTMsg = {
      v: 1,
      kind: "hash_publish",
      from: this.crdt.getClientTag(),
      to: null,
      id: uid(),
      atMs: Date.now(),
      meta,
    } as any;

    await this.safeSend(msg);
  }

  async broadcastOp(op: any) {
    const now = Date.now();
    if (now - this.lastOpMs < this.minOpIntervalMs) return;
    this.lastOpMs = now;

    const msg: RTMsg = {
      v: 1,
      kind: "op",
      from: this.crdt.getClientTag(),
      to: null,
      id: uid(),
      atMs: now,
      op,
    } as any;

    await this.safeSend(msg);
  }

  async requestSnapshot(toPeer: string, want?: { schemaVersion?: string | null; includeOps?: boolean; maxOps?: number }) {
    const msg: RTMsg = {
      v: 1,
      kind: "snapshot_req",
      from: this.crdt.getClientTag(),
      to: toPeer,
      id: uid(),
      atMs: Date.now(),
      want: {
        schemaVersion: want?.schemaVersion ?? null,
        includeOps: !!want?.includeOps,
        maxOps: want?.maxOps ?? 0,
      },
    } as any;

    await this.safeSend(msg);
  }

  async setReferencePeer(peer: string | null) {
    this.hooks.setReferencePeer(peer);
    const msg: RTMsg = {
      v: 1,
      kind: "set_reference_peer",
      from: this.crdt.getClientTag(),
      to: null,
      id: uid(),
      atMs: Date.now(),
      peer,
    } as any;
    await this.safeSend(msg);
  }

  // -------- inbound --------

  private upsertPeer(from: string, meta: CRDTMeta) {
    this.peers.set(from, {
      clientTag: from,
      hash: meta.stateHash,
      schemaVersion: meta.schemaVersion,
      publishedMs: meta.atMs,
    });

    this.hooks.onPeersUpdated?.(this.getPeers());
  }

  private async onMsg(m: RTMsg) {
    const errs = validateRTMsg(m);
    if (errs.length) return;

    // ignore self-broadcast loops
    if (m.from === this.crdt.getClientTag()) return;

    if (m.kind === "hello") {
      this.upsertPeer(m.from, (m as any).meta);
      // respond with our presence/hash (lightweight)
      await this.publishHash();
      return;
    }

    if (m.kind === "presence") {
      this.upsertPeer(m.from, (m as any).meta);
      return;
    }

    if (m.kind === "hash_publish") {
      this.upsertPeer(m.from, (m as any).meta);
      await this.checkMismatchAgainstReference(m.from, (m as any).meta);
      return;
    }

    if (m.kind === "set_reference_peer") {
      // accept only if you want global reference semantics; otherwise ignore
      // default: accept updates (last writer wins) but you can gate by role elsewhere
      this.hooks.setReferencePeer((m as any).peer ?? null);
      await this.hooks.audit?.log("rt.set_reference_peer", true, { from: m.from, peer: (m as any).peer ?? null });
      return;
    }

    if (m.kind === "op") {
      const op = (m as any).op;
      const r = await this.crdt.applyOp(op);
      await this.hooks.audit?.log("rt.apply_op", r.ok, { from: m.from, changed: r.changed, err: r.error });
      if (r.ok && r.changed) await this.publishHash();
      return;
    }

    if (m.kind === "snapshot_req") {
      // send snapshot back
      const req = m as any;
      const bundle = await this.crdt.exportBundle({
        includeOps: !!req.want?.includeOps,
        maxOps: req.want?.maxOps ?? 0,
      });

      const msg: RTMsg = {
        v: 1,
        kind: "snapshot_res",
        from: this.crdt.getClientTag(),
        to: m.from,
        id: uid(),
        atMs: Date.now(),
        inReplyTo: m.id,
        snapshot: bundle.snapshot,
        ops: bundle.ops,
      } as any;

      await this.safeSend(msg);
      return;
    }

    if (m.kind === "snapshot_res") {
      const res = m as any;

      // apply snapshot first
      const r1 = await this.crdt.applySnapshot(res.snapshot);
      await this.hooks.audit?.log("rt.apply_snapshot", r1.ok, { from: m.from, err: r1.error });

      // then apply ops if present
      if (r1.ok && Array.isArray(res.ops)) {
        for (const op of res.ops) {
          const r = await this.crdt.applyOp(op);
          if (!r.ok) break;
        }
      }

      if (r1.ok) await this.publishHash();
      return;
    }

    if (m.kind === "ping") {
      const msg: RTMsg = {
        v: 1,
        kind: "pong",
        from: this.crdt.getClientTag(),
        to: m.from,
        id: uid(),
        atMs: Date.now(),
        nonce: (m as any).nonce,
      } as any;
      await this.safeSend(msg);
      return;
    }
  }

  private async checkMismatchAgainstReference(peerFrom: string, meta: CRDTMeta) {
    const ref = this.hooks.getReferencePeer();
    if (!ref) return;

    // only evaluate mismatch events for reference peer changes
    if (peerFrom !== ref) return;

    const local = await this.crdt.getMeta();
    if (local.stateHash === meta.stateHash) return;

    const ev: MismatchEvent = {
      id: uid(),
      atMs: Date.now(),
      localHash: local.stateHash,
      remoteHash: meta.stateHash,
      referencePeer: ref,
      note: "reference peer hash mismatch",
    };

    this.mismatchBuf.add(ev);

    // also broadcast mismatch signal (optional)
    const msg: RTMsg = {
      v: 1,
      kind: "mismatch",
      from: this.crdt.getClientTag(),
      to: null,
      id: uid(),
      atMs: Date.now(),
      localHash: local.stateHash,
      remoteHash: meta.stateHash,
      referencePeer: ref,
      note: ev.note,
    } as any;

    await this.safeSend(msg);
  }

  private async safeSend(msg: RTMsg) {
    const errs = validateRTMsg(msg);
    if (errs.length) return;
    try {
      await this.t.send(msg);
      await this.hooks.audit?.log("rt.send", true, { kind: msg.kind, to: msg.to });
    } catch (e: any) {
      await this.hooks.audit?.log("rt.send", false, { kind: msg.kind, err: String(e?.message ?? e) });
    }
  }
}
