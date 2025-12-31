// ==========================================
// SYNC HEALTH DASHBOARD — A244 (HARDENED)
// FILE: uiux/advanced/sync_health_ui/SyncHealthDashboard.tsx
// Displays: peers, mismatches, determinism, robustness gates, and force-resync actions.
// ==========================================

import React, { useEffect, useMemo, useState } from "react";
import type { SyncHealthSnapshot, SyncHealthUIAdapter } from "./sync_health_ui_types";
import { requestSnapshotFromUI } from "../rt_ui/snapshot_request_ui";
import type { ConflictUIAdapter } from "../conflicts_ui/conflict_ui_types";
import type { NLCommandRouter } from "../nl/nl_router";

export function SyncHealthDashboard(props: {
  adapter: SyncHealthUIAdapter;

  // for “force resync”
  conflictAdapter?: ConflictUIAdapter;
  nl?: NLCommandRouter;
  nlCtx?: any;

  // optional: show a compact view
  compact?: boolean;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!props.adapter.onChange) return;
    return props.adapter.onChange(() => setTick((x) => x + 1));
  }, [props.adapter]);

  const snap = useMemo<SyncHealthSnapshot>(() => props.adapter.get(), [props.adapter, tick]);

  const peers = useMemo(() => {
    const p = (snap.peers ?? []).slice();
    p.sort((a, b) => (b.isReference ? 1 : 0) - (a.isReference ? 1 : 0) || b.publishedMs - a.publishedMs || a.clientTag.localeCompare(b.clientTag));
    return p;
  }, [snap.peers]);

  const mismatches = useMemo(() => {
    const m = (snap.mismatches ?? []).slice();
    m.sort((a, b) => b.atMs - a.atMs || a.id.localeCompare(b.id));
    return m.slice(0, props.compact ? 5 : 25);
  }, [snap.mismatches, props.compact]);

  const gateEvals = useMemo(() => {
    const g = (snap.gateEvals ?? []).slice();
    return g.slice(0, props.compact ? 6 : 50);
  }, [snap.gateEvals, props.compact]);

  const failing = gateEvals.filter((g) => !g.ok).length;

  return (
    <div className="oly-grid" style={{ gap: 12 }}>
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>Sync Health</div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="oly-badge">ref: {snap.referencePeer ?? "none"}</span>
            {snap.conflictCounts ? (
              <>
                <span className="oly-badge">conflicts: {snap.conflictCounts.open}</span>
                <span className="oly-badge oly-badge-warn">critical: {snap.conflictCounts.criticalOpen ?? 0}</span>
              </>
            ) : null}
            <span className={`oly-badge ${failing ? "oly-badge-warn" : "oly-badge-ok"}`}>
              gates failing: {failing}
            </span>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ForceResyncBar
            referencePeer={snap.referencePeer}
            conflictAdapter={props.conflictAdapter}
            nl={props.nl}
            nlCtx={props.nlCtx}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: props.compact ? "1fr" : "1fr 1fr", gap: 12 }}>
        <PeersCard peers={peers} />
        <DeterminismCard d={snap.determinism ?? null} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: props.compact ? "1fr" : "1fr 1fr", gap: 12 }}>
        <MismatchesCard mismatches={mismatches} />
        <GatesCard gateEvals={gateEvals} />
      </div>
    </div>
  );
}

function ForceResyncBar(props: {
  referencePeer: string | null;
  conflictAdapter?: ConflictUIAdapter;
  nl?: NLCommandRouter;
  nlCtx?: any;
}) {
  const [running, setRunning] = useState(false);

  const peer = props.referencePeer;

  return (
    <>
      <button
        className="oly-btn-primary"
        disabled={running || !peer}
        onClick={() => {
          if (!peer) return;
          void (async () => {
            setRunning(true);
            try {
              await requestSnapshotFromUI({
                adapter: props.conflictAdapter,
                nl: props.nl,
                nlCtx: props.nlCtx,
                peer,
                reason: "force_resync_from_dashboard",
              });
            } finally {
              setRunning(false);
            }
          })();
        }}
      >
        {running ? "Resyncing…" : `Force resync (${peer ?? "no ref"})`}
      </button>

      {!peer ? (
        <span style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
          Set a reference peer to enable force resync.
        </span>
      ) : null}
    </>
  );
}

function PeersCard(props: { peers: Array<{ clientTag: string; schemaVersion: string; hash: string; publishedMs: number; isReference?: boolean }> }) {
  const peers = props.peers ?? [];

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Peers</div>

      {!peers.length ? (
        <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No peers.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {peers.map((p) => (
            <div key={p.clientTag} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 900 }}>
                  {p.clientTag} {p.isReference ? <span className="oly-badge">REF</span> : null}
                </div>
                <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                  schema: {p.schemaVersion || "—"} · hash: {shortHash(p.hash)}
                </div>
              </div>
              <span className="oly-badge">t={formatAgeMs(Date.now() - p.publishedMs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeterminismCard(props: { d: any | null }) {
  const d = props.d;

  const badge = !d ? "oly-badge" : d.ok ? "oly-badge-ok" : "oly-badge-warn";

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Determinism</div>

      {!d ? (
        <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No determinism check configured.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>{d.ok ? "PASS" : "FAIL"}</div>
            <span className={`oly-badge ${badge}`}>{d.source}</span>
          </div>

          <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
            checked: {new Date(d.checkedAtMs).toLocaleString()} · mismatches: {d.mismatches ?? 0}
          </div>

          {!d.ok && d.firstMismatch ? (
            <pre style={{ margin: 0, padding: 10, borderRadius: 12, background: "var(--oly-surface)", overflow: "auto", maxHeight: 180 }}>
{JSON.stringify(d.firstMismatch, null, 2)}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MismatchesCard(props: { mismatches: Array<any> }) {
  const m = props.mismatches ?? [];

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Mismatch Timeline</div>

      {!m.length ? (
        <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No mismatches recorded.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {m.map((x) => (
            <div key={x.id} style={{ border: "1px solid var(--oly-border)", borderRadius: 12, padding: 10, background: "var(--oly-surface)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>{new Date(x.atMs).toLocaleTimeString()}</div>
                <span className="oly-badge">ref: {x.referencePeer ?? "—"}</span>
              </div>
              <div style={{ color: "var(--oly-text-muted)", fontSize: 12, marginTop: 4 }}>
                local: {shortHash(x.localHash)} · remote: {shortHash(x.remoteHash)}
              </div>
              {x.note ? <div style={{ color: "var(--oly-text-muted)", fontSize: 12, marginTop: 6 }}>{x.note}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GatesCard(props: { gateEvals: Array<any> }) {
  const g = props.gateEvals ?? [];

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Robustness Gates</div>

      {!g.length ? (
        <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No gates configured.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {g.map((x) => (
            <div key={x.gateId} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 900 }}>{x.metric}</div>
                <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                  {x.comparator} {x.threshold}
                  {x.note ? ` · ${x.note}` : ""}
                </div>
              </div>
              <span className={`oly-badge ${x.ok ? "oly-badge-ok" : "oly-badge-warn"}`}>
                {x.ok ? "OK" : "FAIL"} {x.value == null ? "" : `(${fmt(x.value)})`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function shortHash(h?: string) {
  const s = (h ?? "").trim();
  if (!s) return "—";
  return s.length <= 10 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function fmt(x: number) {
  if (!Number.isFinite(x)) return String(x);
  // stable compact formatting
  return Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(2) : x.toFixed(4);
}

function formatAgeMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
