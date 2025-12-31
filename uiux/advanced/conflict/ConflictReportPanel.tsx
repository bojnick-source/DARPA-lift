// ==========================================
// CONFLICT REPORT PANEL — A96 (HARDENED)
// Displays the first divergence report in a scrollable panel.
// ==========================================

import React, { useMemo } from "react";
import type { DivergenceReport } from "../health/first_divergence_report";

export function ConflictReportPanel(props: { report?: DivergenceReport }) {
  const r = props.report;

  const summary = useMemo(() => {
    if (!r) return "No report loaded.";
    if (r.ok) return "No divergence detected (snapshots match).";
    return `First mismatch: ${r.firstMismatchPath ?? "(unknown)"} — diffs: ${r.diffs.length}`;
  }, [r]);

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>First Divergence Report</div>
        <button className="oly-btn" onClick={() => void copyReport(r)} style={{ minWidth: 140 }} disabled={!r}>
          Copy JSON
        </button>
      </div>

      <div style={{ marginTop: 10, color: "var(--oly-text-muted)", fontSize: 13 }}>{summary}</div>

      {r ? (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <KV k="localHash" v={r.localHash} />
          <KV k="refHash" v={r.refHash} />
          <KV k="firstMismatchPath" v={r.firstMismatchPath ?? "(none)"} />
        </div>
      ) : null}

      {r && r.diffs.length ? (
        <div
          style={{
            marginTop: 12,
            maxHeight: 260,
            overflow: "auto",
            borderTop: "1px solid var(--oly-border)",
            paddingTop: 10,
            display: "grid",
            gap: 10,
          }}
        >
          {r.diffs.map((d, i) => (
            <div key={i} style={{ border: "1px solid var(--oly-border)", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{d.path}</div>
                <div className="oly-badge">{d.kind}</div>
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                <div>
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>local</div>
                  <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{String(d.local)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>ref</div>
                  <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{String(d.ref)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KV(props: { k: string; v: string }) {
  return (
    <div className="oly-row" style={{ alignItems: "baseline" }}>
      <div style={{ color: "var(--oly-text-muted)" }}>{props.k}</div>
      <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{props.v}</div>
    </div>
  );
}

async function copyReport(r?: DivergenceReport) {
  if (!r) return;
  const text = JSON.stringify(r, null, 2);

  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      // no-op
    }
  }
}
