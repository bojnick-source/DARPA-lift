// ==========================================
// SYNC HEALTH PANEL — A106 (HARDENED)
// Displays:
//  - local/ref hashes
//  - last divergence time
//  - last gate failures summary (optional)
// Actions:
//  - republish hashes
//  - run first divergence report
//  - hard resync
// ==========================================

import React, { useEffect, useMemo, useState } from "react";
import { firstDivergenceReport, type DivergenceReport } from "./first_divergence_report";
import { ConflictReportPanel } from "../conflict/ConflictReportPanel";

export interface SyncHealthHooks {
  getLocalSnapshot: () => any;
  getReferenceSnapshot: () => Promise<any>;
  getLocalHash: () => Promise<string>;        // fast path if you already compute
  getReferenceHash: () => Promise<string | null>;

  // optional: last divergence metadata you already track
  getLastDivergenceMs?: () => number | null;

  // optional: gate failures summary (from selection stage)
  getLastGateFailureSummary?: () => {
    totalCandidates: number;
    dropped: number;
    topFailures: Array<{ metric: string; count: number }>;
  } | null;

  forcePublishHashes?: () => Promise<void>;
  hardResyncFromCRDT?: () => Promise<void>;

  audit?: any; // AuditLogger
  context?: { room?: string; docId?: string; peer?: string };
}

export function SyncHealthPanel(props: { hooks: SyncHealthHooks }) {
  const [localHash, setLocalHash] = useState<string>("(loading)");
  const [refHash, setRefHash] = useState<string>("(loading)");
  const [lastDiv, setLastDiv] = useState<string>("(n/a)");
  const [report, setReport] = useState<DivergenceReport | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const gateSummary = useMemo(() => props.hooks.getLastGateFailureSummary?.() ?? null, [props.hooks]);

  async function refresh() {
    setBusy("Refreshing…");
    try {
      const [lh, rh] = await Promise.all([
        props.hooks.getLocalHash(),
        props.hooks.getReferenceHash(),
      ]);
      setLocalHash(lh);
      setRefHash(rh ?? "(none)");

      const ms = props.hooks.getLastDivergenceMs?.() ?? null;
      setLastDiv(ms ? new Date(ms).toLocaleString() : "(n/a)");
    } finally {
      setBusy(null);
    }
  }

  async function runReport() {
    setBusy("Running report…");
    try {
      const local = props.hooks.getLocalSnapshot();
      const ref = await props.hooks.getReferenceSnapshot();
      const r = await firstDivergenceReport({
        local,
        ref,
        audit: props.hooks.audit,
        context: props.hooks.context,
      });
      setReport(r);
      // update hashes too
      setLocalHash(r.localHash);
      setRefHash(r.refHash);
    } finally {
      setBusy(null);
    }
  }

  async function republishHashes() {
    if (!props.hooks.forcePublishHashes) return;
    setBusy("Publishing…");
    try {
      await props.hooks.forcePublishHashes();
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function hardResync() {
    if (!props.hooks.hardResyncFromCRDT) return;
    setBusy("Resyncing…");
    try {
      await props.hooks.hardResyncFromCRDT();
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const match = useMemo(() => {
    if (localHash.startsWith("(") || refHash.startsWith("(")) return null;
    if (refHash === "(none)") return null;
    return localHash === refHash;
  }, [localHash, refHash]);

  return (
    <div className="oly-card" style={{ padding: 14, background: "var(--oly-surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Sync Health</div>
        <button className="oly-btn" onClick={() => void refresh()} style={{ minWidth: 120 }} disabled={!!busy}>
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <KV k="localHash" v={localHash} />
        <KV k="refHash" v={refHash} />
        <KV k="lastDivergence" v={lastDiv} />
        <KV k="status" v={match === null ? "(unknown)" : match ? "MATCH" : "MISMATCH"} badge={match === null ? undefined : match ? "ok" : "err"} />
      </div>

      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
        <button className="oly-btn-primary" onClick={() => void runReport()} disabled={!!busy} style={{ minWidth: 190 }}>
          {busy ?? "Run divergence report"}
        </button>

        <button className="oly-btn" onClick={() => void republishHashes()} disabled={!!busy || !props.hooks.forcePublishHashes} style={{ minWidth: 190 }}>
          Republish hashes
        </button>

        <button className="oly-btn" onClick={() => void hardResync()} disabled={!!busy || !props.hooks.hardResyncFromCRDT} style={{ minWidth: 190 }}>
          Hard resync
        </button>
      </div>

      {gateSummary ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Last Run — Gate Summary</div>
          <div style={{ display: "grid", gap: 6 }}>
            <KV k="totalCandidates" v={String(gateSummary.totalCandidates)} />
            <KV k="dropped" v={String(gateSummary.dropped)} />
          </div>
          {gateSummary.topFailures?.length ? (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {gateSummary.topFailures.slice(0, 8).map((x, i) => (
                <div key={i} className="oly-row" style={{ alignItems: "baseline" }}>
                  <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{x.metric}</div>
                  <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12, color: "var(--oly-text-muted)" }}>
                    {x.count}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {report ? (
        <div style={{ marginTop: 14 }}>
          <ConflictReportPanel report={report} />
        </div>
      ) : null}
    </div>
  );
}

function KV(props: { k: string; v: string; badge?: "ok" | "err" }) {
  return (
    <div className="oly-row" style={{ alignItems: "baseline" }}>
      <div style={{ color: "var(--oly-text-muted)" }}>{props.k}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{props.v}</div>
        {props.badge ? <div className={`oly-badge oly-badge-${props.badge}`}>{props.badge.toUpperCase()}</div> : null}
      </div>
    </div>
  );
}
