// ==========================================
// DETERMINISTIC REPLAY — A35 (HARDENED)
// Read JSONL into AuditEvent[] (Node or browser string input).
// ==========================================

import type { AuditEvent } from "../audit_types";

export function parseJsonl(text: string): AuditEvent[] {
  const out: AuditEvent[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object") out.push(e as AuditEvent);
    } catch {
      // ignore bad lines
    }
  }
  return out;
}
