// ==========================================
// NL EXECUTION — A111 (HARDENED)
// Applies NLCommand via safe hooks only.
// ==========================================

import type { NLCommand, RobustnessGatesPolicy, GateMetricKey, GateTagKey } from "./nl_types";
import { DEFAULT_ROBUSTNESS_GATES, validateRobustnessGates } from "../policy/robustness_gates";

export interface NLActions {
  openPanel: (panel: string) => void;
  getValue: (path: string) => any;
  setValue: (path: string, value: any) => void;
  runDivergenceReport?: () => Promise<void>;
  hardResyncFromCRDT?: () => Promise<void>;
  republishHashes?: () => Promise<void>;
  audit?: { log: (event: string, ok: boolean, payload?: any) => Promise<void> | void };
}

export interface ExecuteResult {
  ok: boolean;
  note?: string;
}

function ensurePolicy(a: NLActions): RobustnessGatesPolicy {
  const p = a.getValue("policy.robustness_gates") as RobustnessGatesPolicy | undefined;
  if (!p || typeof p !== "object") return structuredClone(DEFAULT_ROBUSTNESS_GATES);
  return structuredClone(p);
}

function gateKey(metric: GateMetricKey, tag: GateTagKey): string {
  return tag ? `${metric}.${tag}` : metric;
}

export async function executeNL(cmd: NLCommand, a: NLActions): Promise<ExecuteResult> {
  await a.audit?.log("ui.nl_cmd", true, { kind: cmd.kind, normalized: cmd.normalized, confidence: cmd.confidence });

  switch (cmd.kind) {
    case "help": {
      a.openPanel("nl_help");
      return { ok: true };
    }

    case "open_panel": {
      a.openPanel(cmd.panel);
      return { ok: true };
    }

    case "run_divergence_report": {
      if (!a.runDivergenceReport) return { ok: false, note: "runDivergenceReport not wired" };
      await a.runDivergenceReport();
      return { ok: true };
    }

    case "hard_resync": {
      if (!a.hardResyncFromCRDT) return { ok: false, note: "hardResyncFromCRDT not wired" };
      await a.hardResyncFromCRDT();
      return { ok: true };
    }

    case "republish_hashes": {
      if (!a.republishHashes) return { ok: false, note: "republishHashes not wired" };
      await a.republishHashes();
      return { ok: true };
    }

    case "toggle": {
      if (cmd.target === "haptics.enabled") {
        a.setValue("ui.haptics.enabled", cmd.value);
        return { ok: true };
      }
      if (cmd.target === "policy.robustness_gates.enabled") {
        const p = ensurePolicy(a);
        p.enabled = cmd.value;
        const issues = validateRobustnessGates(p);
        if (issues.length) return { ok: false, note: "Invalid policy after toggle" };
        a.setValue("policy.robustness_gates", p);
        return { ok: true };
      }
      if (cmd.target === "policy.robustness_gates.requireAll") {
        const p = ensurePolicy(a);
        p.requireAll = cmd.value;
        const issues = validateRobustnessGates(p);
        if (issues.length) return { ok: false, note: "Invalid policy after toggle" };
        a.setValue("policy.robustness_gates", p);
        return { ok: true };
      }
      return { ok: false, note: "Unknown toggle target" };
    }

    case "set_gate": {
      const p = ensurePolicy(a);
      const key = gateKey(cmd.metric, cmd.tag);

      const idx = p.gates.findIndex((g) => {
        const k = g.tag ? `${g.metric}.${g.tag}` : g.metric;
        return k === key;
      });

      const nextGate = {
        enabled: true,
        metric: cmd.metric,
        tag: cmd.tag || undefined,
        op: cmd.op,
        value: cmd.value,
        unit: p.gates[idx]?.unit ?? "",
        note: p.gates[idx]?.note ?? "",
      };

      if (idx >= 0) p.gates[idx] = { ...p.gates[idx], ...nextGate };
      else p.gates.push(nextGate as any);

      const issues = validateRobustnessGates(p);
      if (issues.length) {
        await a.audit?.log("ui.nl_cmd_fail", false, { kind: cmd.kind, issues });
        return { ok: false, note: "Invalid policy after gate update" };
      }

      a.setValue("policy.robustness_gates", p);
      a.openPanel("robustness_gates");
      return { ok: true };
    }

    case "unknown":
    default:
      return { ok: false, note: cmd.reason ?? "unknown_command" };
  }
}
