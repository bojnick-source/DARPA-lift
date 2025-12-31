// ==========================================
// HAPTICS EVENT BINDINGS — A247 (HARDENED)
// FILE: uiux/advanced/haptics/haptics_bindings.ts
// Binds haptics to app events without importing UI components.
// ==========================================

import type { Haptics } from "./haptics";

export interface HapticEvents {
  // Provide minimal hooks from your app:
  onCommandResult?: (cb: (r: { ok: boolean; safe?: boolean }) => void) => () => void;
  onConflictAdded?: (cb: (c: { severity: "info" | "warn" | "critical" }) => void) => () => void;
  onResyncDone?: (cb: (r: { ok: boolean }) => void) => () => void;
  onSelectionChanged?: (cb: () => void) => () => void;
}

export function bindHaptics(h: Haptics, ev: HapticEvents) {
  const offs: Array<() => void> = [];

  if (ev.onCommandResult) {
    offs.push(
      ev.onCommandResult((r) => {
        if (r.ok) h.cue("success");
        else h.cue(r.safe === false ? "critical" : "warning");
      })
    );
  }

  if (ev.onConflictAdded) {
    offs.push(
      ev.onConflictAdded((c) => {
        if (c.severity === "critical") h.cue("critical");
        else if (c.severity === "warn") h.cue("warning");
      })
    );
  }

  if (ev.onResyncDone) {
    offs.push(
      ev.onResyncDone((r) => {
        h.cue(r.ok ? "confirm" : "reject");
      })
    );
  }

  if (ev.onSelectionChanged) {
    offs.push(
      ev.onSelectionChanged(() => {
        h.cue("selection");
      })
    );
  }

  return () => offs.forEach((f) => f());
}
