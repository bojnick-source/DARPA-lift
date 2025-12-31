// ==========================================
// WEBSOCKET TRANSPORT (STUB) — A182 (HARDENED)
// FILE: uiux/advanced/rt/ws_transport.ts
// - Minimal implementation; depends on WebSocket in runtime
// - Routes via 'to' on receiver side; server can also route
// ==========================================

import type { RTTransport, TransportState } from "./transport";
import type { RTMsg } from "./protocol";
import { validateRTMsg } from "./protocol";

type Listener<T> = (x: T) => void;

export class WebSocketTransport implements RTTransport {
  kind: "ws" = "ws";

  private url: string;
  private st: TransportState = "closed";
  private err?: string;

  private ws?: WebSocket;

  private msgSubs = new Set<Listener<RTMsg>>();
  private stateSubs = new Set<(s: TransportState, err?: string) => void>();

  constructor(opts: { url: string }) {
    this.url = opts.url;
  }

  state(): TransportState {
    return this.st;
  }

  private setState(s: TransportState, err?: string) {
    this.st = s;
    this.err = err;
    for (const cb of this.stateSubs) cb(s, err);
  }

  async open(): Promise<void> {
    if (this.st === "open" || this.st === "opening") return;
    this.setState("opening");

    if (typeof WebSocket === "undefined") {
      this.setState("error", "WebSocket not available in this runtime");
      throw new Error("WebSocket not available");
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        this.setState("open");
        resolve();
      };

      ws.onerror = () => {
        this.setState("error", "ws error");
        reject(new Error("ws error"));
      };

      ws.onclose = () => {
        if (this.st !== "closed") this.setState("closed");
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as RTMsg;
          const errs = validateRTMsg(msg);
          if (errs.length) return; // drop invalid
          for (const cb of this.msgSubs) cb(msg);
        } catch {
          // drop
        }
      };
    });
  }

  async close(): Promise<void> {
    this.ws?.close();
    this.ws = undefined;
    this.setState("closed");
  }

  async send(msg: RTMsg): Promise<void> {
    const errs = validateRTMsg(msg);
    if (errs.length) throw new Error(`invalid msg: ${errs[0]}`);
    if (!this.ws || this.st !== "open") throw new Error("ws not open");
    this.ws.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: RTMsg) => void): () => void {
    this.msgSubs.add(cb);
    return () => this.msgSubs.delete(cb);
  }

  onState(cb: (s: TransportState, err?: string) => void): () => void {
    this.stateSubs.add(cb);
    return () => this.stateSubs.delete(cb);
  }
}
