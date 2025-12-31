// ==========================================
// DESKTOP SHELL BOOTSTRAP (ELECTRON/TAURI STUB) — A255 (HARDENED)
// FILE: uiux/advanced/platform/desktop_bootstrap.ts
// This is a scaffold: real desktop packaging decides Electron vs Tauri.
// It shows how to override platform detection deterministically.
// ==========================================

import { computeCapabilities } from "./capabilities";
import { decideUI } from "./adaptive_ui";

export interface DesktopBootstrapResult {
  caps: ReturnType<typeof computeCapabilities>;
  ui: ReturnType<typeof decideUI>;
}

export function bootstrapDesktopShell(): DesktopBootstrapResult {
  // Desktop shell can provide OS/platform overrides.
  const caps = computeCapabilities({ platformOverride: "desktop" });
  const ui = decideUI(caps);
  return { caps, ui };
}
