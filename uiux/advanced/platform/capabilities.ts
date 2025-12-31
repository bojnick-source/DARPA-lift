// ==========================================
// CAPABILITIES MATRIX — A253 (HARDENED)
// FILE: uiux/advanced/platform/capabilities.ts
// Single source of truth for feature gating across desktop/tablet/web.
// ==========================================

export type PlatformKind = "web" | "desktop" | "tablet";
export type OSKind = "ios" | "ipados" | "android" | "windows" | "macos" | "linux" | "unknown";

export interface Capabilities {
  platform: PlatformKind;
  os: OSKind;

  // input
  hasMouse: boolean;
  hasTouch: boolean;
  hasPen: boolean;

  // core features
  realtimeCollab: boolean;
  haptics: boolean;

  // XR
  xr: { ar: boolean; vr: boolean };

  // performance hints
  prefersReducedMotion: boolean;
  lowPower: boolean;

  // networking
  hasWebRTC: boolean;
}

export function detectOS(): OSKind {
  const ua = (navigator.userAgent ?? "").toLowerCase();
  if (ua.includes("ipad")) return "ipados";
  if (ua.includes("iphone")) return "ios";
  if (ua.includes("android")) return "android";
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function detectPlatform(): PlatformKind {
  // conservative: treat iPad as tablet
  const os = detectOS();
  if (os === "ipados" || os === "android") return "tablet";
  // desktop shells will override this (see desktop bootstrap)
  return "web";
}

export function computeCapabilities(opts?: {
  // allow desktop shell override
  platformOverride?: PlatformKind;
  osOverride?: OSKind;
}): Capabilities {
  const os = opts?.osOverride ?? detectOS();
  const platform = opts?.platformOverride ?? detectPlatform();

  const hasTouch = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  const hasMouse = typeof window !== "undefined" && matchMedia?.("(pointer:fine)")?.matches === true;
  const hasPen = typeof window !== "undefined" && matchMedia?.("(pointer:coarse)")?.matches === false && hasTouch; // heuristic; real pen detection is app-level

  const prefersReducedMotion = typeof window !== "undefined" && matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  const lowPower = typeof navigator !== "undefined" && (navigator as any).connection?.saveData === true;

  const haptics = typeof navigator !== "undefined" && typeof (navigator as any).vibrate === "function";
  const hasWebRTC = typeof window !== "undefined" && typeof (window as any).RTCPeerConnection !== "undefined";

  // WebXR may not exist. Gate conservatively.
  const hasWebXR = typeof navigator !== "undefined" && typeof (navigator as any).xr !== "undefined";

  return {
    platform,
    os,
    hasMouse,
    hasTouch,
    hasPen,

    realtimeCollab: true, // feature is enabled; transport decides actual availability
    haptics,

    xr: {
      ar: hasWebXR,
      vr: hasWebXR,
    },

    prefersReducedMotion,
    lowPower,
    hasWebRTC,
  };
}
