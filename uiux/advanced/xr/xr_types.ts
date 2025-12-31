// ==========================================
// XR INPUT TYPES — A249 (HARDENED)
// FILE: uiux/advanced/xr/xr_types.ts
// XR is treated as an adapter layer, not a new app.
// The core state + CRDT remains the same.
// ==========================================

export type XRMode = "none" | "ar" | "vr";

export type XRInputKind = "gaze" | "hand" | "controller" | "mouse" | "touch" | "pen";

export interface XRPointerPose {
  // World space
  position: [number, number, number];
  direction: [number, number, number];
  // Optional confidence for hand tracking, etc.
  confidence?: number; // 0..1
}

export interface XRGesture {
  kind: "tap" | "pinch" | "grab" | "drag" | "rotate" | "scale";
  // world-space pose or 2D screen-space (adapter decides)
  pose?: XRPointerPose;
  delta?: {
    translation?: [number, number, number];
    rotationQuat?: [number, number, number, number];
    scale?: number;
  };
}

export interface XRInputEvent {
  atMs: number;
  source: XRInputKind;
  // one of: pointer pose update or gesture action
  pointer?: XRPointerPose;
  gesture?: XRGesture;

  // selection targeting hint
  targetId?: string;
  meta?: any;
}

export interface XRViewportInfo {
  mode: XRMode;
  // 3D view scale in meters per unit (adapter chooses)
  worldScale: number;
  // 2D viewport size if rendering into a canvas
  widthPx?: number;
  heightPx?: number;
}

export interface XRAdapter {
  // lifecycle
  start: (mode: XRMode) => Promise<void>;
  stop: () => Promise<void>;

  // status
  getViewport: () => XRViewportInfo;

  // input stream
  onInput: (cb: (e: XRInputEvent) => void) => () => void;

  // optional: render tick hook
  onFrame?: (cb: (dtMs: number) => void) => () => void;
}
