// ==========================================
// CONFLICT DRAWER — A71/A97 (HARDENED)
// Displays conflict detail plus optional first-divergence report.
// ==========================================

import React, { useMemo, useState } from "react";
import type { ConflictEvent } from "./conflict_types";
import { firstDivergenceReport } from "../health/first_divergence_report";
import { ConflictReportPanel } from "./ConflictReportPanel";

export interface ConflictDrawerActions {
  openPanel(panel: string): void;
  getLocalSnapshot: () => any;
  getReferenceSnapshot: () => Promise<any>;
  hardResyncFromCRDT?: () => Promise<void>;
  audit?: any; // AuditLogger
  context?: { room?: string; docId?: string; peer?: string };
}

export function ConflictDetailsDrawer(props: {
  open: boolean;
  conflict?: ConflictEvent;
  onClose(): void;
  actions: ConflictDrawerActions;
}) {
  const c = props.conflict;
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);

  const title = useMemo(() => {
    if (!c) return "Conflict";
    if (c.kind === "hash_mismatch") return "Sync mismatch";
    if (c.kind === "first_divergence") return "State divergence";
    if (c.kind === "transport") return "Transport issue";
    if (c.kind === "permission") return "Permission issue";
    return "Conflict";
  }, [c?.kind]);

  async function runReport() {
    setLoading(true);
    try {
      const local = props.actions.getLocalSnapshot();
      const ref = await props.actions.getReferenceSnapshot();

      const r = await firstDivergenceReport({
        local,
        ref,
        audit: props.actions.audit,
        context: props.actions.context,
      });

      setReport(r);
    } finally {
      setLoading(false);
    }
  }

  if (!props.open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1200,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={props.onClose}
    >
      <div
        className="oly-card"
        style={{
          width: "min(560px, 92vw)",
          height: "100%",
          borderRadius: 0,
          borderLeft: "1px solid var(--oly-border)",
          background: "var(--oly-surface)",
          padding: 16,
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <button className="oly-btn" onClick={props.onClose} style={{ minWidth: 96 }}>
            Close
          </button>
        </div>

        <div style={{ marginTop: 10, color: "var(--oly-text-muted)", fontSize: 13 }}>
          {c?.detail?.message ?? "No conflict selected."}
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <button className="oly-btn-primary" onClick={() => props.actions.openPanel("sync_health")}>
            Open Sync Health
          </button>

          <button className="oly-btn" onClick={() => void runReport()} disabled={loading}>
            {loading ? "Running report…" : "Run First Divergence Report"}
          </button>

          <button
            className="oly-btn"
            disabled={!props.actions.hardResyncFromCRDT}
            onClick={() => void props.actions.hardResyncFromCRDT?.()}
          >
            Hard Resync from CRDT
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          <ConflictReportPanel report={report ?? undefined} />
        </div>
      </div>
    </div>
  );
}

// Alias exports for V2 compatibility
export type ConflictDrawerActionsV2 = ConflictDrawerActions;
export const ConflictDetailsDrawerV2 = ConflictDetailsDrawer;
