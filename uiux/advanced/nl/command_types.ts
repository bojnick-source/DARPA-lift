// ==========================================
// NL COMMAND TYPES — A191 (HARDENED)
// FILE: uiux/advanced/nl/command_types.ts
// ==========================================

export type CommandRole = "host" | "editor" | "viewer";

export type CommandRisk =
  | "safe"        // read-only, view navigation, help
  | "normal"      // non-destructive edits that are reversible
  | "dangerous";  // could delete, reset, hard-resync, change policies

export interface CommandContext {
  v: 1;

  // role + collaboration context
  role: CommandRole;
  isCollaborative: boolean;
  referencePeer: string | null;

  // current selection / focus
  focusedPanel?: string;            // e.g. "optimizer", "morphology", "sync", "conflicts"
  selectedEntityId?: string | null; // current item selected

  // optional: state summary, redacted
  stateSummary?: Record<string, any>;
}

export interface CommandArgumentSpec {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "json";
  required?: boolean;
  enumValues?: string[];
  description?: string;
}

export interface CommandDef {
  id: string;               // stable
  title: string;            // UI label
  description: string;
  risk: CommandRisk;

  // NLP matching
  // examples are used to match + prompt the user
  examples: string[];

  // structured args
  args?: CommandArgumentSpec[];

  // permission gating (minimum)
  minRole: CommandRole;

  // if true, requires explicit confirmation even when role allows
  requireConfirm?: boolean;
}

export interface ParsedCommand {
  ok: boolean;
  // if ok=false
  error?: string;

  // if ok=true
  id?: string;
  args?: Record<string, any>;
  confidence?: number; // 0..1
  rawText?: string;
}

export interface CommandResult {
  ok: boolean;
  message: string;

  // optional data for UI updates
  data?: any;
}

export interface CommandExecution {
  def: CommandDef;
  parsed: ParsedCommand;
  ctx: CommandContext;
}
