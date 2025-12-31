// ==========================================
// CONFLICT INBOX STORE — A122 (HARDENED)
// Bounded, ack-able conflict event store.
// ==========================================

export type ConflictSeverity = "info" | "warn" | "err";

export interface ConflictEvent {
  v: 1;
  id: string;
  tsMs: number;
  severity: ConflictSeverity;
  kind: string;
  room?: string;
  docId?: string;
  peer?: { clientTag?: string };
  detail?: Record<string, any>;
}

export interface ConflictInboxItem extends ConflictEvent {
  acked: boolean;
  ackTsMs?: number;
}

export interface ConflictInboxState {
  maxItems: number;
  items: ConflictInboxItem[];
}

export const DEFAULT_INBOX_STATE: ConflictInboxState = {
  maxItems: 200,
  items: [],
};

export class ConflictInboxStore {
  private state: ConflictInboxState;

  constructor(initial?: Partial<ConflictInboxState>) {
    this.state = { ...DEFAULT_INBOX_STATE, ...(initial ?? {}) };
  }

  getState(): ConflictInboxState {
    return this.state;
  }

  push(evt: ConflictEvent): void {
    const severity = evt.severity === "error" ? "err" : (evt.severity as any);
    const normalized: ConflictEvent = { ...evt, severity } as any;

    const existingIdx = this.state.items.findIndex((x) => x.id === normalized.id);
    const item: ConflictInboxItem = { ...normalized, acked: existingIdx >= 0 ? this.state.items[existingIdx].acked : false };

    if (existingIdx >= 0) {
      const prev = this.state.items[existingIdx];
      this.state.items[existingIdx] = { ...item, ackTsMs: prev.ackTsMs };
      return;
    }

    this.state.items.unshift(item);
    if (this.state.items.length > this.state.maxItems) this.state.items.length = this.state.maxItems;
  }

  ack(id: string): void {
    const i = this.state.items.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.state.items[i].acked = true;
    this.state.items[i].ackTsMs = Date.now();
  }

  clearAcked(): void {
    this.state.items = this.state.items.filter((x) => !x.acked);
  }

  clearAll(): void {
    this.state.items = [];
  }
}
