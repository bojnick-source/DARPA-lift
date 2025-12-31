// ==========================================
// REAL-TIME CONFLICT HANDLING — A18 (HARDENED)
// Client upgrade:
//   - uses Patch kinds
//   - on remote op mismatch: requests snapshot
//   - sends pathset ops with LWW policy by default (safe for form-like state edits)
// ==========================================

import type { CollabMsgV2, DocId, Patch, PathSetOp } from "../protocol_v2";

type Json = any;

export interface CollabClientV2Options {
  url: string;
  docId: DocId;
  reconnectMs?: number;
  maxQueue?: number;
}

export interface CollabCallbacksV2 {
  onSnapshot(state: Json, version: number): void;
  onRemoteOp(patch: Patch, baseVersion: number, opId: string): void;
  onConflict?(info: Extract<CollabMsgV2, { t: "conflict" }>): void;
  onPresence?(msg: Extract<CollabMsgV2, { t: "presence" }>): void;
  onStatus?(status: "connecting" | "open" | "closed" | "error"): void;
  onError?(code: string, message: string): void;
}

interface PendingOp {
  opId: string;
  baseVersion: number;
  patch: Patch;
}

function safeParse(s: string): any | null { try { return JSON.parse(s); } catch { return null; } }
function uuid(): string { return (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

export class CollabClientV2 {
  private ws: WebSocket | null = null;
  private opts: Required<CollabClientV2Options>;
  private cb: CollabCallbacksV2;

  private version = 0;
  private queue: PendingOp[] = [];
  private inflight = new Map<string, PendingOp>();
  private reconnectAttempt = 0;
  private closedByUser = false;

  constructor(opts: CollabClientV2Options, cb: CollabCallbacksV2) {
    this.opts = { reconnectMs: 1000, maxQueue: 256, ...opts } as Required<CollabClientV2Options>;
    this.cb = cb;
  }

  connect(): void { this.closedByUser = false; this.open(); }
  close(): void { this.closedByUser = true; try { this.ws?.close(); } catch {} this.ws = null; }

  getVersion(): number { return this.version; }

  sendSet(fullState: any): void {
    this.sendOp({ kind: "set", value: fullState });
  }

  sendMergeRoot(obj: Record<string, any>): void {
    this.sendOp({ kind: "merge", value: obj });
  }

  sendPathSets(ops: Array<{ path: string; value: any }>): void {
    const stamped: PathSetOp[] = ops.map((o) => ({ path: o.path, value: o.value, ts: Date.now() }));
    this.sendOp({ kind: "pathset", ops: stamped, policy: "lww_pathset" });
  }

  sendPresence(cursor?: any, selection?: any): void {
    this.sendMsg({ t: "presence", docId: this.opts.docId, clientId: "local", cursor, selection });
  }

  private open(): void {
    this.cb.onStatus?.("connecting");
    this.ws = new WebSocket(this.opts.url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.cb.onStatus?.("open");
      this.sendMsg({ t: "hello", clientId: "local", docId: this.opts.docId, lastSeenVersion: this.version });
      this.flush();
    };

    this.ws.onclose = () => {
      this.cb.onStatus?.("closed");
      this.ws = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };

    this.ws.onerror = () => this.cb.onStatus?.("error");

    this.ws.onmessage = (ev) => {
      const msg = safeParse(String(ev.data));
      if (!msg || typeof msg !== "object") return;
      this.handle(msg as CollabMsgV2);
    };
  }

  private scheduleReconnect(): void {
    const base = this.opts.reconnectMs;
    const ms = Math.min(8000, base * Math.pow(2, this.reconnectAttempt++));
    setTimeout(() => { if (!this.closedByUser) this.open(); }, ms);
  }

  private sendMsg(msg: CollabMsgV2): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private sendOp(patch: Patch): void {
    const opId = uuid();
    const p: PendingOp = { opId, baseVersion: this.version, patch };

    if (this.queue.length >= this.opts.maxQueue) {
      this.cb.onError?.("QUEUE_FULL", "Too many pending ops; refusing new op.");
      return;
    }
    this.queue.push(p);
    this.flush();
  }

  private flush(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.queue.length > 0) {
      const p = this.queue.shift()!;
      this.inflight.set(p.opId, p);
      this.sendMsg({ t: "op", docId: this.opts.docId, baseVersion: p.baseVersion, opId: p.opId, patch: p.patch });
    }
  }

  private handle(msg: CollabMsgV2): void {
    switch (msg.t) {
      case "snapshot":
        if (msg.docId !== this.opts.docId) return;
        this.version = msg.version;
        this.inflight.clear();
        this.queue = [];
        this.cb.onSnapshot(msg.state, msg.version);
        return;

      case "op":
        if (msg.docId !== this.opts.docId) return;
        if (msg.baseVersion !== this.version) {
          this.cb.onError?.("RESYNC_NEEDED", "Remote op baseVersion mismatch; requesting snapshot.");
          this.sendMsg({ t: "hello", clientId: "local", docId: this.opts.docId, lastSeenVersion: this.version });
          return;
        }
        this.cb.onRemoteOp(msg.patch, msg.baseVersion, msg.opId);
        this.version += 1;
        return;

      case "ack":
        if (msg.docId !== this.opts.docId) return;
        this.inflight.delete(msg.opId);
        this.version = msg.newVersion;
        return;

      case "conflict":
        if (msg.docId !== this.opts.docId) return;
        this.cb.onConflict?.(msg);
        // if not applied, resync
        if (!msg.applied) {
          this.sendMsg({ t: "hello", clientId: "local", docId: this.opts.docId, lastSeenVersion: this.version });
        }
        return;

      case "presence":
        if (msg.docId !== this.opts.docId) return;
        this.cb.onPresence?.(msg);
        return;

      case "error":
        this.cb.onError?.(msg.code, msg.message);
        if (msg.code === "VERSION_MISMATCH") {
          this.sendMsg({ t: "hello", clientId: "local", docId: this.opts.docId, lastSeenVersion: this.version });
        }
        return;

      default:
        return;
    }
  }
}
