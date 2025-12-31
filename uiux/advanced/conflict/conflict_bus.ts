// ==========================================
// CONFLICT BUS — A123 (HARDENED)
// Lightweight event emitter for conflict notifications.
// ==========================================

import type { ConflictEvent as LegacyConflictEvent } from "./conflict_types";
import type { ConflictEvent as InboxConflictEvent } from "./inbox_store";

type ConflictEvent = LegacyConflictEvent | InboxConflictEvent;
type Listener = (e: ConflictEvent) => void;

export class ConflictBus {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: ConflictEvent): void {
    this.listeners.forEach((fn) => {
      try {
        fn(e);
      } catch {
        // swallow
      }
    });
  }
}
