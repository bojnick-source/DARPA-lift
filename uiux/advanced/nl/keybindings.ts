// ==========================================
// KEYBINDINGS (PALETTE OPEN) — A228 (HARDENED)
// FILE: uiux/advanced/nl/keybindings.ts
// ==========================================

export function installPaletteKeybinding(opts: { onToggle: () => void }) {
  const handler = (e: KeyboardEvent) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      opts.onToggle();
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
