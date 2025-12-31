// ==========================================
// NL COMMAND BAR UI — A196 (HARDENED)
// FILE: uiux/advanced/nl/NLCommandBar.tsx
// - input field
// - shows parse result + confirm prompt
// - executes via provided executor + handlers
// ==========================================

import React, { useMemo, useState } from "react";
import type { CommandContext, CommandResult } from "./command_types";
import { parseCommand } from "./intent_parser";
import { getCommand } from "./command_registry";
import { guardCommand } from "./command_guards";
import type { CommandHandlers, AuditSink } from "./command_executor";
import { executeParsedCommand } from "./command_executor";

export function NLCommandBar(props: {
  ctx: CommandContext;
  handlers: CommandHandlers;
  audit?: AuditSink;
}) {
  const [text, setText] = useState("");
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState<{ id: string; title: string } | null>(null);

  const parsed = useMemo(() => parseCommand(text), [text]);
  const def = parsed.ok ? getCommand(parsed.id!) : undefined;
  const guard = def ? guardCommand(def, parsed, props.ctx) : null;

  async function run(confirmed: boolean) {
    const res = await executeParsedCommand({
      parsed,
      ctx: props.ctx,
      handlers: props.handlers,
      audit: props.audit,
      confirmed,
    });

    setLastResult(res);

    if (!res.ok && res.message.startsWith("confirm required") && def) {
      setNeedsConfirm({ id: def.id, title: def.title });
    } else {
      setNeedsConfirm(null);
    }
  }

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Type a command (e.g., "open sync", "force publish", "help")'
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid var(--oly-border)",
            background: "var(--oly-surface)",
            color: "var(--oly-text)",
            outline: "none",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        />
        <button className="oly-btn-primary" onClick={() => void run(false)} disabled={!parsed.ok || !!guard?.requiresConfirm}>
          Run
        </button>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {parsed.ok && def ? (
          <span className="oly-badge">
            {def.title} · {def.risk.toUpperCase()} · conf {Math.round((parsed.confidence ?? 0) * 100)}%
          </span>
        ) : (
          <span className="oly-badge oly-badge-warn">{parsed.ok ? "OK" : parsed.error ?? "…"}</span>
        )}

        {def && guard && !guard.ok ? <span className="oly-badge oly-badge-warn">blocked: {guard.reason}</span> : null}

        {def && guard?.requiresConfirm ? (
          <span className="oly-badge oly-badge-warn">confirm required</span>
        ) : null}
      </div>

      {needsConfirm ? (
        <div style={{ marginTop: 10 }} className="oly-card">
          <div style={{ padding: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>
              Confirm: <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{needsConfirm.title}</span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="oly-btn" onClick={() => setNeedsConfirm(null)}>
                Cancel
              </button>
              <button className="oly-btn-primary" onClick={() => void run(true)}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lastResult ? (
        <div style={{ marginTop: 10, color: lastResult.ok ? "var(--oly-text)" : "var(--oly-warn)" }}>
          {lastResult.message}
        </div>
      ) : null}
    </div>
  );
}
