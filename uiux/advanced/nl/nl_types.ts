// ==========================================
// NL COMMAND UI TYPES — A108 (HARDENED)
// Safe, typed NL command system.
// ==========================================

export type PanelId =
  | "sync_health"
  | "robustness_gates"
  | "conflicts"
  | "migration"
  | "unknown";

export type ToggleTarget =
  | "haptics.enabled"
  | "policy.robustness_gates.enabled"
  | "policy.robustness_gates.requireAll";

export type GateMetricKey =
  | "unsafe_contact_rate"
  | "fall_over_rate"
  | "sim_error_rate"
  | "temp_max_c"
  | "landing_impulse"
  | "slip_rate"
  | "specific_power_w_per_kg";

export type GateTagKey = "q10" | "q90" | "cvar95_upper" | "";

export interface NLCommandBase {
  v: 1;
  raw: string;
  normalized: string;
  confidence: number; // 0..1
}

export interface CmdOpenPanel extends NLCommandBase {
  kind: "open_panel";
  panel: PanelId;
}

export interface CmdRunDivergenceReport extends NLCommandBase {
  kind: "run_divergence_report";
}

export interface CmdHardResync extends NLCommandBase {
  kind: "hard_resync";
}

export interface CmdRepublishHashes extends NLCommandBase {
  kind: "republish_hashes";
}

export interface CmdToggle extends NLCommandBase {
  kind: "toggle";
  target: ToggleTarget;
  value: boolean;
}

export interface CmdSetGate extends NLCommandBase {
  kind: "set_gate";
  metric: GateMetricKey;
  tag: GateTagKey;
  op: "<=" | ">=";
  value: number;
}

export interface CmdHelp extends NLCommandBase {
  kind: "help";
}

export interface CmdUnknown extends NLCommandBase {
  kind: "unknown";
  reason?: string;
}

export type NLCommand =
  | CmdOpenPanel
  | CmdRunDivergenceReport
  | CmdHardResync
  | CmdRepublishHashes
  | CmdToggle
  | CmdSetGate
  | CmdHelp
  | CmdUnknown;
