// ==========================================
// NL PARSER — A110 (HARDENED)
// Whitelist parser with limited actions.
// ==========================================

import { normalizeNL } from "./normalize";
import type {
  NLCommand,
  PanelId,
  ToggleTarget,
  GateMetricKey,
  GateTagKey,
} from "./nl_types";

const PANEL_ALIASES: Array<[RegExp, PanelId]> = [
  [/^open (sync health|sync)$/i, "sync_health"],
  [/^open (robustness gates|gates|policy)$/i, "robustness_gates"],
  [/^open (conflicts|conflict)$/i, "conflicts"],
  [/^open (migration|upgrade)$/i, "migration"],
];

const TOGGLE_ALIASES: Array<[RegExp, ToggleTarget]> = [
  [/(haptics)/i, "haptics.enabled"],
  [/(robustness gates enabled|gates enabled|policy gates enabled)/i, "policy.robustness_gates.enabled"],
  [/(require all gates|require all)/i, "policy.robustness_gates.requireAll"],
];

const METRIC_ALIASES: Record<string, GateMetricKey> = {
  unsafe_contact_rate: "unsafe_contact_rate",
  fall_over_rate: "fall_over_rate",
  sim_error_rate: "sim_error_rate",
  temp_max_c: "temp_max_c",
  landing_impulse: "landing_impulse",
  slip_rate: "slip_rate",
  specific_power_w_per_kg: "specific_power_w_per_kg",

  // common shortcuts
  slip: "slip_rate",
  temp: "temp_max_c",
  impulse: "landing_impulse",
  specific_power: "specific_power_w_per_kg",
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function makeBase(raw: string, normalized: string, confidence: number) {
  return { v: 1 as const, raw, normalized, confidence: clamp01(confidence) };
}

function parseBoolFromText(s: string): boolean | null {
  if (/\b(on|enable|enabled|true|yes)\b/.test(s)) return true;
  if (/\b(off|disable|disabled|false|no)\b/.test(s)) return false;
  return null;
}

function parseNumber(s: string): number | null {
  const m = s.match(/(-?\d+(\.\d+)?|\.\d+)(e-?\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseOp(s: string): "<=" | ">=" | null {
  if (s.includes("<=")) return "<=";
  if (s.includes(">=")) return ">=";
  if (/\bmax\b/.test(s)) return "<="; // "max slip 0.05" implies <=
  if (/\bmin\b/.test(s)) return ">="; // "min specific power 250" implies >=
  return null;
}

function parseGateTag(s: string): GateTagKey {
  if (/\bq10\b/.test(s)) return "q10";
  if (/\bq90\b/.test(s)) return "q90";
  if (/\bcvar95\b/.test(s) || /\bcvar95_upper\b/.test(s) || /\bcvar\b/.test(s)) return "cvar95_upper";
  return "";
}

function parseMetricAndTagFromKey(s: string): { metric: GateMetricKey | null; tag: GateTagKey } {
  let key = s.trim();

  const tag = parseGateTag(key);

  key = key.replaceAll(".", "_").replaceAll("-", "_");

  if (key.endsWith("_q10")) key = key.slice(0, -4);
  if (key.endsWith("_q90")) key = key.slice(0, -4);
  if (key.endsWith("_cvar95_upper")) key = key.slice(0, -12);

  const tokens = key.split(/\s+/).join("_");
  const m = METRIC_ALIASES[tokens] ?? METRIC_ALIASES[tokens.replace(/__+/g, "_")];

  return { metric: m ?? null, tag };
}

export function parseNL(raw: string): NLCommand {
  const normalized = normalizeNL(raw);

  if (!normalized) {
    return { ...makeBase(raw, normalized, 0), kind: "unknown", reason: "empty" };
  }

  if (/^(help|\?)$/.test(normalized) || normalized.includes("what can i say")) {
    return { ...makeBase(raw, normalized, 0.9), kind: "help" };
  }

  for (const [rx, panel] of PANEL_ALIASES) {
    if (rx.test(normalized)) {
      return { ...makeBase(raw, normalized, 0.95), kind: "open_panel", panel };
    }
  }
  if (normalized.startsWith("open ")) {
    return { ...makeBase(raw, normalized, 0.4), kind: "open_panel", panel: "unknown" };
  }

  if (/^(run|do) (divergence report|first divergence report|diff report)$/.test(normalized)) {
    return { ...makeBase(raw, normalized, 0.95), kind: "run_divergence_report" };
  }

  if (/^(hard )?resync( from crdt)?$/.test(normalized) || /^resync$/.test(normalized)) {
    return { ...makeBase(raw, normalized, 0.95), kind: "hard_resync" };
  }

  if (/^(republish|publish) (hashes|hash)$/.test(normalized)) {
    return { ...makeBase(raw, normalized, 0.95), kind: "republish_hashes" };
  }

  if (normalized.includes("haptics") || normalized.includes("gates") || normalized.includes("require all")) {
    const b = parseBoolFromText(normalized);
    if (b !== null) {
      const target = TOGGLE_ALIASES.find(([rx]) => rx.test(normalized))?.[1] ?? "haptics.enabled";
      return { ...makeBase(raw, normalized, 0.75), kind: "toggle", target, value: b };
    }
  }

  if (normalized.startsWith("set gate ") || normalized.startsWith("gate ")) {
    const tail = normalized.replace(/^set gate\s+/, "").replace(/^gate\s+/, "");

    const op = parseOp(tail) ?? (/\bto\b/.test(tail) ? "<=" : null);
    const value = parseNumber(tail);

    const metricPhrase = tail.split(/\b(to|<=|>=)\b/)[0].trim();
    const mt = parseMetricAndTagFromKey(metricPhrase);

    if (mt.metric && value !== null) {
      const inferred = op ?? (mt.metric === "specific_power_w_per_kg" ? ">=" : "<=");

      return {
        ...makeBase(raw, normalized, 0.8),
        kind: "set_gate",
        metric: mt.metric,
        tag: mt.tag,
        op: inferred,
        value,
      };
    }

    return { ...makeBase(raw, normalized, 0.35), kind: "unknown", reason: "gate_parse_failed" };
  }

  return { ...makeBase(raw, normalized, 0.25), kind: "unknown", reason: "no_match" };
}
