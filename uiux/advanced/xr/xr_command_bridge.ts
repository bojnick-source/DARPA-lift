// ==========================================
// XR COMMAND BRIDGE — A250 (HARDENED)
// FILE: uiux/advanced/xr/xr_command_bridge.ts
// Converts XR gestures into deterministic UI commands.
// This is a thin layer that emits command ids + args (no direct state mutation).
// ==========================================

import type { XRInputEvent } from "./xr_types";

export interface XRCommandEvent {
  atMs: number;
  commandId: string;
  args: any;
}

export type XRCommandListener = (c: XRCommandEvent) => void;

export class XRCommandBridge {
  private listeners = new Set<XRCommandListener>();

  onCommand(cb: XRCommandListener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  handleInput(e: XRInputEvent) {
    // Deterministic mapping: no randomness.
    // Keep mappings minimal; app-specific commands can be layered later.

    if (e.gesture?.kind === "tap") {
      this.emit(e.atMs, "select", { targetId: e.targetId ?? null });
      return;
    }

    if (e.gesture?.kind === "pinch") {
      // pinch => open palette (common XR UX)
      this.emit(e.atMs, "palette_open", {});
      return;
    }

    if (e.gesture?.kind === "drag") {
      this.emit(e.atMs, "viewport_pan", { delta: e.gesture.delta?.translation ?? [0, 0, 0] });
      return;
    }

    if (e.gesture?.kind === "rotate") {
      this.emit(e.atMs, "viewport_orbit", { quat: e.gesture.delta?.rotationQuat ?? [0, 0, 0, 1] });
      return;
    }

    if (e.gesture?.kind === "scale") {
      this.emit(e.atMs, "viewport_zoom", { scale: e.gesture.delta?.scale ?? 1.0 });
      return;
    }
  }

  private emit(atMs: number, commandId: string, args: any) {
    const ev: XRCommandEvent = { atMs, commandId, args };
    for (const cb of this.listeners) cb(ev);
  }
}
