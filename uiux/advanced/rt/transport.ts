// ==========================================
// TRANSPORT INTERFACE — A180 (HARDENED)
// FILE: uiux/advanced/rt/transport.ts
// ==========================================

import type { RTMsg } from "./protocol";

export type TransportState = "closed" | "opening" | "open" | "error";

export interface RTTransport {
  kind: "memory" | "ws";

  state(): TransportState;

  // connect and start receiving
  open(): Promise<void>;

  // close connection
  close(): Promise<void>;

  // send a message (transport may broadcast or route by 'to')
  send(msg: RTMsg): Promise<void>;

  // subscribe to inbound messages
  onMessage(cb: (msg: RTMsg) => void): () => void;

  // subscribe to state changes
  onState(cb: (s: TransportState, err?: string) => void): () => void;
}
