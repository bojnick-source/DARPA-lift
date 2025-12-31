// ==========================================
// IN-MEMORY TRANSPORT (DEV + TEST) — A181 (HARDENED)
// FILE: uiux/advanced/rt/memory_transport.ts
// - Simulates rooms via shared bus
// - Supports broadcast and directed messages
// ==========================================

import type { RTTransport, TransportState } from "./transport";
import type { RTMsg } from "./protocol";
import { validateRTMsg } from "./protocol";

type Listener<T> = (x: T) => void;

interface Bus {
  room: string;
  clients: Map<string, Listener<RTMsg>>;
}

const GLOBAL_BUSES: Map<string, Bus> = new Map();

function getBus(room: string): Bus {
  const b = GLOBAL_BUSES.get(room);
  if (b) return b;
  const nb: Bus = { room, clients: new Map() };
  GLOBAL_BUSES.set(room, nb);
  return nb;
}

export class MemoryTransport implements RTTransport {
  kind: "memory" = "memory";

  private room: string;
  private clientTag: string;

  private st: TransportState = "closed";
  private err?: string;

  private msgSubs = new Set<Listener<RTMsg>>();
  private stateSubs = new Set<(s: TransportState, err?: string) => void>();

  constructor(opts: { room: string; clientTag: string }) {
    this.room = opts.room;
    this.clientTag = opts.clientTag;
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
    const bus = getBus(this.room);
    bus.clients.set(this.clientTag, (msg) => {
      // deliver only if targeted or broadcast
      if (msg.to !== null && msg.to !== this.clientTag) return;
      for (const cb of this.msgSubs) cb(msg);
    });
    this.setState("open");
  }

  async close(): Promise<void> {
    const bus = getBus(this.room);
    bus.clients.delete(this.clientTag);
    this.setState("closed");
  }

  async send(msg: RTMsg): Promise<void> {
    const errs = validateRTMsg(msg);
    if (errs.length) throw new Error(`invalid msg: ${errs[0]}`);

    const bus = getBus(this.room);

    // broadcast
    if (msg.to === null) {
      for (const [, deliver] of bus.clients) deliver(msg);
      return;
    }

    // directed
    const deliver = bus.clients.get(msg.to);
    if (deliver) deliver(msg);
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
