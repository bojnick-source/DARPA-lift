// ==========================================
// NL COMMAND REGISTRY — A225 (HARDENED)
// FILE: uiux/advanced/nl/command_registry.ts
// Deterministic, auditable command routing with schema-aware gating.
// ==========================================

export type CommandScope = "global" | "project" | "editor" | "sim" | "optimize";

export interface CommandContext {
  clientTag: string;
  role?: "host" | "editor" | "viewer";
  selection?: any;           // current selected object(s)
  focus?: CommandScope;      // current UI focus
  meta?: any;                // schema/meta snapshot
}

export interface CommandResult {
  ok: boolean;
  message?: string;
  data?: any;
  // if false, UI should show a conflict toast
  safe?: boolean;
}

export interface CommandSpec {
  id: string;                      // stable id
  title: string;
  scope: CommandScope;
  // keywords for fuzzy match
  keywords: string[];
  // examples for UI
  examples?: string[];

  // policy gates
  requiresRole?: Array<"host" | "editor">;
  requiresSelection?: boolean;

  // deterministic execution. Do NOT call Date.now / Math.random inside.
  run: (args: any, ctx: CommandContext) => Promise<CommandResult>;
}

export interface ParseResult {
  ok: boolean;
  commandId?: string;
  args?: any;
  // UI feedback
  confidence?: number; // 0..1
  reason?: string;
}

export class CommandRegistry {
  private map = new Map<string, CommandSpec>();

  register(cmd: CommandSpec) {
    if (!cmd.id) throw new Error("command missing id");
    if (this.map.has(cmd.id)) throw new Error(`duplicate command id: ${cmd.id}`);
    this.map.set(cmd.id, cmd);
  }

  get(id: string): CommandSpec | undefined {
    return this.map.get(id);
  }

  list(): CommandSpec[] {
    return [...this.map.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.title.localeCompare(b.title));
  }

  // simple deterministic parser:
  // 1) if the input begins with "/" treat first token as command id
  // 2) else fuzzy match by keywords
  parse(text: string): ParseResult {
    const t = (text ?? "").trim();
    if (!t) return { ok: false, reason: "empty" };

    if (t.startsWith("/")) {
      const [raw, ...rest] = t.slice(1).split(/\s+/);
      const cmd = this.map.get(raw);
      if (!cmd) return { ok: false, reason: `unknown command: ${raw}` };

      const args = parseArgs(rest.join(" "));
      return { ok: true, commandId: cmd.id, args, confidence: 1.0 };
    }

    // fuzzy keyword scoring: count keyword hits
    const scored: Array<{ id: string; score: number }> = [];
    for (const cmd of this.map.values()) {
      let score = 0;
      for (const kw of cmd.keywords) {
        if (kw && t.toLowerCase().includes(kw.toLowerCase())) score += 1;
      }
      if (score > 0) scored.push({ id: cmd.id, score });
    }

    if (!scored.length) return { ok: false, reason: "no match" };

    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const best = scored[0];
    const confidence = Math.min(0.9, 0.4 + 0.15 * best.score);

    return { ok: true, commandId: best.id, args: { text }, confidence };
  }
}

// minimal key=value parser. deterministic.
function parseArgs(s: string): Record<string, any> {
  const out: Record<string, any> = {};
  const t = (s ?? "").trim();
  if (!t) return out;

  // tokenizes by spaces unless quoted
  const tokens = tokenize(t);
  for (const tok of tokens) {
    const idx = tok.indexOf("=");
    if (idx < 0) {
      out._ = out._ ? [...out._, tok] : [tok];
      continue;
    }
    const k = tok.slice(0, idx).trim();
    const v = tok.slice(idx + 1).trim();
    out[k] = coerce(v);
  }
  return out;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) {
        q = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch as any;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur), (cur = "");
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function coerce(v: string): any {
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== "") return n;
  return v;
}
