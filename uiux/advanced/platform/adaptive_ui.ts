// ==========================================
// ADAPTIVE UI POLICY — A254 (HARDENED)
// FILE: uiux/advanced/platform/adaptive_ui.ts
// Central policy that decides layout mode and input affordances.
// ==========================================

import type { Capabilities } from "./capabilities";

export type LayoutMode = "desktop_dense" | "tablet_touch" | "hybrid";

export interface AdaptiveUIPolicy {
  layout: LayoutMode;

  // input affordances
  showHoverHints: boolean;
  useLargeHitTargets: boolean;
  enableContextMenus: boolean;

  // feature toggles (UI)
  enableXRButtons: boolean;
  enableHaptics: boolean;
  enableRealtime: boolean;

  // perf toggles
  reduceMotion: boolean;
}

export function decideUI(c: Capabilities): AdaptiveUIPolicy {
  const tablet = c.platform === "tablet" || c.os === "ipados";

  const layout: LayoutMode =
    tablet && !c.hasMouse ? "tablet_touch" :
    tablet && c.hasMouse ? "hybrid" :
    "desktop_dense";

  const showHoverHints = c.hasMouse;
  const useLargeHitTargets = tablet || c.hasTouch;
  const enableContextMenus = c.hasMouse; // long-press menus can be added later for touch

  const enableXRButtons = c.xr.ar || c.xr.vr;
  const enableHaptics = c.haptics && !c.lowPower;
  const enableRealtime = c.realtimeCollab;

  const reduceMotion = c.prefersReducedMotion || c.lowPower;

  return {
    layout,
    showHoverHints,
    useLargeHitTargets,
    enableContextMenus,

    enableXRButtons,
    enableHaptics,
    enableRealtime,

    reduceMotion,
  };
}
