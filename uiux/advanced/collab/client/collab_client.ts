// ==========================================
// REAL-TIME COLLAB — A13 (HARDENED)
// Client sync layer: hello->snapshot, optimistic ops, ack tracking, resync on mismatch.
// ==========================================

import type { CollabMsg, DocId } from "../protocol";

type Json = any;

export interface CollabClientOptions {
  url: string;            // ws://localhost:8787
  docId: DocId;
  reconnectMs?: number;   // default 1000..8000 backoff
  maxQueue?: number;      // default 256
}

export interface CollabCallbacks {
  onSnapshot(state: Json, version: number): void;
  onRemoteOp(patch: any, baseVersion: number, opId: string): void;
  onPresence?(msg: Extract<CollabMsg, { t: "presence" }>): void;
  onStatus?(status: "connecting" | "open" | "closed" | "error"): void;
  onError?(code: string, message: string): void;
}

interface PendingOp {
  opId: string;
  baseVersion: number;
  patch: any;
}

function safeParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function uuid(): string {
  // browser-safe UUID
  return (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class CollabClient {
  private ws: WebSocket | null = null;
  private opts: Required<CollabClientOptions>;
  private cb: CollabCallbacks;

  private version = 0;
  private queue: PendingOp[] = [];
  private inflight = new Map<string, PendingOp>();
  private reconnectAttempt = 0;
  private closedByUser = false;

  constructor(opts: CollabClientOptions, cb: CollabCallbacks) {
    this.opts = {
      reconnectMs: 1000,
      maxQueue: 256,
      ...opts,
    } as Required<CollabClientOptions>;
    this.cb = cb;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }

  getVersion(): number {
    return this.version;
  }

  // Minimal patch helpers matching server (safe defaults)
  sendSet(fullState: any): void {
    this.sendOp({ $set: fullState });
  }

  sendMergeRoot(obj: Record<string, any>): void {
    this.sendOp({ $merge: obj });
  }

  sendPathSets(ops: Array<{ path: string; value: any }>): void {
    this.sendOp(ops);
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
    };

    this.ws.onclose = () => {
      this.cb.onStatus?.("closed");
      this.ws = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.cb.onStatus?.("error");
    };

    this.ws.onmessage = (ev) => {
      const parsed = safeParse(String(ev.data));
      if (!parsed || typeof parsed !== "object") return;
      this.handle(parsed as CollabMsg);
    };
  }

  private scheduleReconnect(): void {
    const base = this.opts.reconnectMs;
    const max = 8000;
    const ms = Math.min(max, base * Math.pow(2, this.reconnectAttempt++));
    setTimeout(() => {
      if (!this.closedByUser) this.open();
    }, ms);
  }

  private sendMsg(msg: CollabMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private sendOp(patch: any): void {
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

    // send all queued ops immediately; keep inflight for acks
    while (this.queue.length > 0) {
      const p = this.queue.shift()!;
      this.inflight.set(p.opId, p);
      this.sendMsg({
        t: "op",
        docId: this.opts.docId,
        baseVersion: p.baseVersion,
        opId: p.opId,
        patch: p.patch,
      });
    }
  }

  private handle(msg: CollabMsg): void {
    switch (msg.t) {
      case "snapshot": {
        if (msg.docId !== this.opts.docId) return;
        this.version = msg.version;
        this.inflight.clear();
        this.queue = [];
        this.cb.onSnapshot(msg.state, msg.version);
        return;
      }

      case "op": {
        if (msg.docId !== this.opts.docId) return;
        // Remote op may arrive out-of-order in lossy conditions.
        // We enforce a strict version model:
        // - If baseVersion != local version, request resync.
        if (msg.baseVersion !== this.version) {
          this.cb.onError?.("RESYNC_NEEDED", "Remote op baseVersion mismatch; requesting snapshot.");
          this.sendMsg({ t: "hello", clientId: "local", docId: this.opts.docId, lastSeenVersion: this.version });
          return;
        }
        this.cb.onRemoteOp(msg.patch, msg.baseVersion, msg.opId);
        this.version += 1;
        return;
      }

      case "ack": {
        if (msg.docId !== this.opts.docId) return;
        const p = this.inflight.get(msg.opId);
        if (p) this.inflight.delete(msg.opId);
        // Ack defines authoritative version
        this.version = msg.newVersion;
        return;
      }

      case "presence": {
        if (msg.docId !== this.opts.docId) return;
        this.cb.onPresence?.(msg);
        return;
      }

      case "error": {
        this.cb.onError?.(msg.code, msg.message);
        // If out-of-date, resync
        if (msg.code === "VERSION_MISMATCH") {
          this.sendMsg({ t: "hello", clientId: "local", docId: this.opts.docId, lastSeenVersion: this.version });
        }
        return;
      }

      default:
        return;
    }
  }
}
