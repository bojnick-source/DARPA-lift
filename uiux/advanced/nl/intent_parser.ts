// ==========================================
// SIMPLE INTENT PARSER (NO LLM) — A193 (HARDENED)
// FILE: uiux/advanced/nl/intent_parser.ts
// Deterministic keyword/regex parsing to avoid hallucination.
// Swap later with an LLM, but keep this as safe fallback.
// ==========================================

import type { ParsedCommand } from "./command_types";
import { COMMANDS } from "./command_registry";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function isNumber(x: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(x.trim());
}

export function parseCommand(text: string): ParsedCommand {
  const raw = text ?? "";
  const t = norm(raw);

  if (!t) return { ok: false, error: "empty", rawText: raw };

  // hard rules first
  if (t === "help" || t.includes("show commands") || t.includes("what can i say")) {
    return { ok: true, id: "help", args: {}, confidence: 0.95, rawText: raw };
  }

  // open panel
  const openMatch = t.match(/^(open|go to|show)\s+(?<panel>[a-z0-9_\- ]+)$/);
  if (openMatch?.groups?.panel) {
    return {
      ok: true,
      id: "open_panel",
      args: { panel: openMatch.groups.panel.trim() },
      confidence: 0.85,
      rawText: raw,
    };
  }

  // reference peer
  if (t.includes("reference peer")) {
    const m = t.match(/reference peer( to)?\s+(?<peer>.+)$/);
    const peer = m?.groups?.peer?.trim();
    if (!peer || peer === "none" || peer === "null" || peer === "clear") {
      return { ok: true, id: "set_reference_peer", args: { peer: null }, confidence: 0.8, rawText: raw };
    }
    return { ok: true, id: "set_reference_peer", args: { peer }, confidence: 0.8, rawText: raw };
  }

  // request snapshot
  if (t.includes("snapshot") || t.includes("resync") || t.includes("pull snapshot")) {
    const m = t.match(/(from)\s+(?<peer>[a-z0-9_\-]+)$/);
    const peer = m?.groups?.peer?.trim();
    if (peer) return { ok: true, id: "request_snapshot", args: { peer }, confidence: 0.75, rawText: raw };
  }

  // force publish
  if (t.includes("force publish") || t.includes("publish hash") || t.includes("broadcast my state")) {
    return { ok: true, id: "force_publish", args: {}, confidence: 0.85, rawText: raw };
  }

  // ack conflict
  if (t.startsWith("ack conflict") || t.startsWith("mark conflict")) {
    const m = t.match(/(ack conflict|mark conflict( resolved)?)\s+(?<id>[a-z0-9_\-]+)$/);
    const id = m?.groups?.id?.trim();
    if (id) return { ok: true, id: "ack_conflict", args: { id }, confidence: 0.85, rawText: raw };
  }

  // auto ack conflicts
  if (t.includes("auto ack") && t.includes("conflict")) {
    return { ok: true, id: "auto_ack_conflicts", args: {}, confidence: 0.85, rawText: raw };
  }

  // gates
  if (t.startsWith("set ") || t.startsWith("gate ")) {
    // patterns:
    // set unsafe_contact_rate to 0.02
    // gate slip_rate_q90 0.05
    const m1 = t.match(/^set\s+(?<name>[a-z0-9_]+)\s+to\s+(?<value>[-\d.]+)$/);
    if (m1?.groups?.name && m1?.groups?.value && isNumber(m1.groups.value)) {
      return {
        ok: true,
        id: "set_robustness_gate",
        args: { name: m1.groups.name, value: Number(m1.groups.value) },
        confidence: 0.8,
        rawText: raw,
      };
    }
    const m2 = t.match(/^gate\s+(?<name>[a-z0-9_]+)\s+(?<value>[-\d.]+)$/);
    if (m2?.groups?.name && m2?.groups?.value && isNumber(m2.groups.value)) {
      return {
        ok: true,
        id: "set_robustness_gate",
        args: { name: m2.groups.name, value: Number(m2.groups.value) },
        confidence: 0.8,
        rawText: raw,
      };
    }
  }

  // optimizer start/stop
  if (t.includes("start optimization") || t === "run optimizer" || t.includes("begin search")) {
    return { ok: true, id: "start_optimization", args: {}, confidence: 0.75, rawText: raw };
  }
  if (t.includes("stop optimization") || t.includes("halt optimizer") || t.includes("pause search")) {
    return { ok: true, id: "stop_optimization", args: {}, confidence: 0.75, rawText: raw };
  }

  // fallback: attempt match by examples (low confidence)
  for (const c of COMMANDS) {
    for (const ex of c.examples) {
      if (t === norm(ex)) return { ok: true, id: c.id, args: {}, confidence: 0.55, rawText: raw };
    }
  }

  return { ok: false, error: "unrecognized command", rawText: raw };
}
