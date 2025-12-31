// ==========================================
// SYNC HEALTH PANEL — A214 (HARDENED)
// FILE: uiux/advanced/sync/SyncHealthPanel.tsx
// Shows: severity, reference peer, peer hashes, mismatch stream, conflicts, determinism, gate status.
// ==========================================

import React, { useMemo, useState } from "react";
import type { SyncHealthSnapshot, RobustnessGateEval, HealthSeverity } from "./sync_health_types";

function sevBadge(s: HealthSeverity) {
  return s === "critical" ? "oly-badge-warn" : s === "warn" ? "oly-badge" : "oly-badge-ok";
}

function shortHash(h: string) {
  if (!h) return "";
  return h.length <= 12 ? h : `${h.slice(0, 6)}…${h.slice(-4)}`;
}

export function SyncHealthPanel(props: {
  snap: SyncHealthSnapshot;

  // optional actions
  onRequestSnapshot?: (peer: string) => void;
  onSetReferencePeer?: (peer: string | null) => void;
}) {
  const s = props.snap;

  const [showAllPeers, setShowAllPeers] = useState(false);
  const [showAllMismatches, setShowAllMismatches] = useState(false);

  const peers = useMemo(() => {
    if (showAllPeers) return s.peers;
    return s.peers.slice(0, 6);
  }, [s.peers, showAllPeers]);

  const mismatches = useMemo(() => {
    if (showAllMismatches) return s.mismatches;
    return s.mismatches.slice(0, 5);
  }, [s.mismatches, showAllMismatches]);

  const gateEvals = (s.gates?.evals ?? []).slice().sort((a, b) => {
    const ra = a.ok ? 1 : 0;
    const rb = b.ok ? 1 : 0;
    return ra - rb;
  });

  return (
    <div className="oly-grid" style={{ gap: 12 }}>
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>Sync Health</div>
          <span className={`oly-badge ${sevBadge(s.severity)}`}>{s.severity.toUpperCase()}</span>
        </div>

        {s.headline ? <div style={{ marginTop: 8, fontWeight: 800 }}>{s.headline}</div> : null}

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span className="oly-badge">ref: {s.referencePeer ?? "none"}</span>
          <span className="oly-badge">conflicts open: {s.conflictCounts.open}</span>
          <span className="oly-badge oly-badge-warn">critical: {s.conflictCounts.criticalOpen}</span>
          {s.determinism ? (
            <span className={`oly-badge ${s.determinism.ok ? "oly-badge-ok" : "oly-badge-warn"}`}>
              determinism: {s.determinism.ok ? "OK" : "FAIL"}
            </span>
          ) : (
            <span className="oly-badge">determinism: —</span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Peer hashes */}
        <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Peers</div>
            <button className="oly-btn" onClick={() => setShowAllPeers((x) => !x)}>
              {showAllPeers ? "Show less" : "Show all"}
            </button>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {!peers.length ? (
              <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No peers published yet.</div>
            ) : null}

            {peers.map((p) => (
              <div key={p.clientTag} className="oly-row" style={{ alignItems: "center" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{p.clientTag}</div>
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                    {p.schemaVersion} · {shortHash(p.hash)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {props.onSetReferencePeer ? (
                    <button className="oly-btn" onClick={() => props.onSetReferencePeer?.(p.clientTag)}>
                      Set ref
                    </button>
                  ) : null}

                  {props.onRequestSnapshot ? (
                    <button className="oly-btn-primary" onClick={() => props.onRequestSnapshot?.(p.clientTag)}>
                      Snapshot
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Drift / mismatches */}
        <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Drift</div>
            <button className="oly-btn" onClick={() => setShowAllMismatches((x) => !x)}>
              {showAllMismatches ? "Show less" : "Show all"}
            </button>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {!mismatches.length ? (
              <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No mismatches recorded.</div>
            ) : null}

            {mismatches.map((m) => (
              <div key={m.id} style={{ padding: 10, borderRadius: 12, border: "1px solid var(--oly-border)", background: "var(--oly-surface)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span className="oly-badge oly-badge-warn">MISMATCH</span>
                  <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12, color: "var(--oly-text-muted)" }}>
                    {new Date(m.atMs).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ marginTop: 6, color: "var(--oly-text-muted)", fontSize: 12 }}>
                  ref: {m.referencePeer ?? "none"}
                </div>
                <div style={{ marginTop: 6, fontFamily: "var(--oly-mono)", fontSize: 12 }}>
                  local: {shortHash(m.localHash)} · remote: {shortHash(m.remoteHash)}
                </div>
                {m.note ? <div style={{ marginTop: 6, color: "var(--oly-text-muted)", fontSize: 12 }}>{m.note}</div> : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Robustness gates */}
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ fontWeight: 900 }}>Robustness Gates</div>

        {!s.gates ? (
          <div style={{ marginTop: 8, color: "var(--oly-text-muted)", fontSize: 13 }}>
            No gates configured yet (policy.robustness_gates is empty).
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
              last eval: {s.gates.evaluatedAtMs ? new Date(s.gates.evaluatedAtMs).toLocaleTimeString() : "—"}
            </div>

            {!gateEvals.length ? (
              <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>
                Gates configured, but no evaluation metrics available yet.
              </div>
            ) : (
              gateEvals.map((e) => <GateRow key={e.gate.name} ev={e} />)
            )}
          </div>
        )}
      </div>

      {/* Determinism */}
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ fontWeight: 900 }}>Determinism</div>
        {!s.determinism ? (
          <div style={{ marginTop: 8, color: "var(--oly-text-muted)", fontSize: 13 }}>No determinism check recorded yet.</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span className={`oly-badge ${s.determinism.ok ? "oly-badge-ok" : "oly-badge-warn"}`}>
                {s.determinism.ok ? "OK" : "FAIL"}
              </span>
              <span className="oly-badge">{s.determinism.source}</span>
              <span className="oly-badge">checked: {new Date(s.determinism.checkedAtMs).toLocaleTimeString()}</span>
              {s.determinism.total != null ? <span className="oly-badge">total: {s.determinism.total}</span> : null}
              {s.determinism.mismatches != null ? <span className="oly-badge">mismatches: {s.determinism.mismatches}</span> : null}
            </div>

            {s.determinism.firstMismatch ? (
              <pre style={{ margin: 0, padding: 10, borderRadius: 12, background: "var(--oly-surface)", overflow: "auto" }}>
{JSON.stringify(s.determinism.firstMismatch, null, 2)}
              </pre>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function GateRow(props: { ev: RobustnessGateEval }) {
  const e = props.ev;
  const ok = e.ok;

  const badge = ok ? "oly-badge-ok" : "oly-badge-warn";
  const valueStr = e.value == null ? "—" : String(e.value);

  return (
    <div className="oly-row" style={{ alignItems: "center" }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontWeight: 800 }}>
          <span className={`oly-badge ${badge}`}>{ok ? "PASS" : "FAIL"}</span>{" "}
          <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{e.gate.name}</span>
        </div>
        <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
          gate: value {e.gate.comparator} {e.gate.threshold}
          {e.gate.units ? ` ${e.gate.units}` : ""}
          {e.gate.quantile ? ` (${e.gate.quantile})` : ""}
        </div>
        {e.note ? <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>{e.note}</div> : null}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="oly-badge">{valueStr}</span>
      </div>
    </div>
  );
}
