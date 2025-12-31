// ==========================================
// COMMAND PALETTE UI — A227 (HARDENED)
// FILE: uiux/advanced/nl/CommandPalette.tsx
// Minimal palette: search commands, preview, execute. Designed for iPad + keyboard + mouse.
// ==========================================

import React, { useMemo, useState } from "react";
import type { CommandRegistry, CommandSpec, CommandContext } from "./command_registry";
import type { NLCommandRouter } from "./nl_router";

export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;

  registry: CommandRegistry;
  router: NLCommandRouter;

  // live context
  ctx: CommandContext;
}) {
  const [q, setQ] = useState("");
  const [raw, setRaw] = useState("");
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; message?: string } | null>(null);

  const cmds = useMemo(() => filterCommands(props.registry.list(), q), [props.registry, q]);

  async function run(text: string) {
    setRunning(true);
    setLast(null);
    try {
      const r = await props.router.exec(text, props.ctx);
      setLast({ ok: r.ok, message: r.message });
      if (r.ok) props.onClose();
    } finally {
      setRunning(false);
    }
  }

  if (!props.open) return null;

  return (
    <div className="oly-modal-backdrop" onMouseDown={props.onClose}>
      <div className="oly-modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "95vw" }}>
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>Command Palette</div>
            <button className="oly-btn" onClick={props.onClose}>Close</button>
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search commands (keywords)…"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ border: "1px solid var(--oly-border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: 8, background: "var(--oly-surface2)", fontWeight: 800 }}>Commands</div>
              <div style={{ maxHeight: 280, overflow: "auto" }}>
                {cmds.map((c) => (
                  <button
                    key={c.id}
                    className="oly-list-item"
                    onClick={() => {
                      // put a runnable default in raw
                      setRaw(`/${c.id}`);
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{c.title}</div>
                    <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                      {c.scope} · {c.id}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ border: "1px solid var(--oly-border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: 8, background: "var(--oly-surface2)", fontWeight: 800 }}>Run</div>
              <div style={{ padding: 10, display: "grid", gap: 8 }}>
                <textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder='Type e.g. "/snapshot_request peer=host" or plain english'
                  style={{ height: 120 }}
                />

                <button className="oly-btn-primary" disabled={running || !raw.trim()} onClick={() => void run(raw)}>
                  {running ? "Running…" : "Execute"}
                </button>

                {last ? (
                  <div className={`oly-badge ${last.ok ? "oly-badge-ok" : "oly-badge-warn"}`}>
                    {last.ok ? "OK" : "FAIL"} {last.message ? `— ${last.message}` : ""}
                  </div>
                ) : (
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                    Commands are auditable and may raise conflicts on unsafe failure.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
            Tip: map <span style={{ fontFamily: "var(--oly-mono)" }}>Cmd/Ctrl+K</span> to open this palette.
          </div>
        </div>
      </div>
    </div>
  );
}

function filterCommands(cmds: CommandSpec[], q: string): CommandSpec[] {
  const t = (q ?? "").trim().toLowerCase();
  if (!t) return cmds.slice(0, 40);

  const scored = cmds
    .map((c) => {
      const hay = `${c.title} ${c.id} ${c.keywords.join(" ")} ${c.examples?.join(" ") ?? ""}`.toLowerCase();
      const score = scoreText(hay, t);
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title));

  return scored.slice(0, 40).map((x) => x.c);
}

function scoreText(hay: string, needle: string): number {
  if (hay.includes(needle)) return 10;
  const parts = needle.split(/\s+/).filter(Boolean);
  let s = 0;
  for (const p of parts) if (hay.includes(p)) s += 2;
  return s;
}
