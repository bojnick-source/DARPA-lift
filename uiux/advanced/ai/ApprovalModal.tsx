// ==========================================
// APPROVAL MODAL (iPad-friendly) — A57 (HARDENED)
// Renders AI-proposed actions with cost flags and requires user approval.
// ==========================================

import React, { useMemo } from "react";

export interface ApprovalModalProps {
  open: boolean;
  title: string;
  summary: string;
  actions: any[];
  onApprove(): void;
  onDeny(): void;

  // optional policy labeling
  costlyPipelines?: string[]; // e.g. ["run_monte_carlo","optimize_cmaes"]
}

type ActionRow =
  | { kind: "set_value"; label: string; details: string; costly?: boolean }
  | { kind: "open_panel"; label: string; details: string; costly?: boolean }
  | { kind: "run_pipeline"; label: string; details: string; costly?: boolean }
  | { kind: "unknown"; label: string; details: string; costly?: boolean };

function safeJson(x: any, max = 180): string {
  let s = "";
  try {
    s = JSON.stringify(x);
  } catch {
    s = String(x);
  }
  if (s.length > max) s = s.slice(0, max) + "…";
  return s;
}

export function ApprovalModal(props: ApprovalModalProps) {
  const rows = useMemo<ActionRow[]>(() => {
    const out: ActionRow[] = [];
    const costly = new Set(props.costlyPipelines ?? []);

    for (const a of props.actions ?? []) {
      if (!a || typeof a !== "object") {
        out.push({ kind: "unknown", label: "Unknown action", details: safeJson(a) });
        continue;
      }

      if (a.type === "set_value") {
        out.push({
          kind: "set_value",
          label: `Set ${String(a.path ?? "(path)")}`,
          details: safeJson(a.value),
        });
        continue;
      }

      if (a.type === "open_panel") {
        out.push({
          kind: "open_panel",
          label: `Open panel`,
          details: String(a.panel ?? "(panel)"),
        });
        continue;
      }

      if (a.type === "run_pipeline") {
        const p = String(a.pipeline ?? "(pipeline)");
        out.push({
          kind: "run_pipeline",
          label: `Run pipeline`,
          details: p,
          costly: costly.has(p),
        });
        continue;
      }

      out.push({ kind: "unknown", label: "Unknown action", details: safeJson(a) });
    }
    return out;
  }, [props.actions, props.costlyPipelines]);

  if (!props.open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 18,
        zIndex: 1000,
      }}
    >
      <div
        className="oly-card"
        style={{
          width: "min(860px, 96vw)",
          maxHeight: "min(78vh, 820px)",
          overflow: "auto",
          padding: 18,
          borderRadius: 10,
          border: "1px solid var(--oly-border)",
          background: "var(--oly-surface)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{props.title}</div>
          <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
            {rows.length} action{rows.length === 1 ? "" : "s"}
          </div>
        </div>

        <div style={{ marginTop: 10, color: "var(--oly-text-muted)", fontSize: 14 }}>{props.summary}</div>

        <div style={{ marginTop: 14, borderTop: "1px solid var(--oly-border)" }} />

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {rows.map((r, i) => (
            <div
              key={i}
              style={{
                padding: 12,
                borderRadius: 8,
                border: "1px solid var(--oly-border)",
                background: "var(--oly-surface2)",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ fontWeight: 650 }}>{r.label}</div>
                {r.costly ? <CostBadge /> : null}
              </div>
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
                {r.details}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button className="oly-btn" onClick={props.onDeny} style={{ minWidth: 120 }}>
            Deny
          </button>
          <button className="oly-btn-primary" onClick={props.onApprove} style={{ minWidth: 160 }}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function CostBadge() {
  return (
    <div
      style={{
        fontSize: 12,
        padding: "4px 10px",
        borderRadius: 999,
        background: "var(--oly-warn)",
        color: "var(--oly-on-accent)",
        fontWeight: 700,
      }}
    >
      HIGH COST
    </div>
  );
}
