// ==========================================
// PRESENCE (AWARENESS) — A31 (HARDENED)
// Adds presence (cursor/selection/user) via Yjs Awareness (y-protocols/awareness).
// ==========================================

import { Awareness } from "y-protocols/awareness";
import type { WebsocketProvider } from "y-websocket";

export interface PresenceUser {
  id: string;
  name?: string;
  role?: string;
}

export interface PresenceState {
  user?: PresenceUser;
  cursor?: { x: number; y: number };
  selection?: { path: string; start?: number; end?: number };
  status?: "idle" | "editing" | "running";
}

export interface PresenceCallbacks {
  onChange?: (states: Array<{ clientId: number; state: PresenceState }>) => void;
}

export class PresenceManager {
  readonly awareness: Awareness;

  constructor(provider: WebsocketProvider, cb?: PresenceCallbacks) {
    this.awareness = provider.awareness;

    if (cb?.onChange) {
      this.awareness.on("change", () => {
        const out: Array<{ clientId: number; state: PresenceState }> = [];
        this.awareness.getStates().forEach((st: any, clientId: number) => {
          out.push({ clientId, state: st as PresenceState });
        });
        cb.onChange!(out);
      });
    }
  }

  setUser(user: PresenceUser): void {
    const st = (this.awareness.getLocalState() as PresenceState) ?? {};
    this.awareness.setLocalState({ ...st, user });
  }

  setCursor(x: number, y: number): void {
    const st = (this.awareness.getLocalState() as PresenceState) ?? {};
    this.awareness.setLocalState({ ...st, cursor: { x, y } });
  }

  setSelection(sel: PresenceState["selection"]): void {
    const st = (this.awareness.getLocalState() as PresenceState) ?? {};
    this.awareness.setLocalState({ ...st, selection: sel });
  }

  setStatus(status: PresenceState["status"]): void {
    const st = (this.awareness.getLocalState() as PresenceState) ?? {};
    this.awareness.setLocalState({ ...st, status });
  }

  clearCursor(): void {
    const st = (this.awareness.getLocalState() as PresenceState) ?? {};
    const { cursor, ...rest } = st;
    this.awareness.setLocalState(rest);
  }
}
