// ==========================================
// NL NORMALIZATION — A109 (HARDENED)
// Deterministic text cleanup for parsing.
// ==========================================

export function normalizeNL(raw: string): string {
  const s = String(raw ?? "");
  return s
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
