// ==========================================
// CONFLICT INBOX PANEL — A209 (HARDENED)
// FILE: uiux/advanced/conflicts/ConflictInboxPanel.tsx
// UI: filter + list + details + ack/resolve/ignore + auto-ack.
// ==========================================

import React, { useMemo, useState } from "react";
import type { ConflictItem, ConflictKind, ConflictSeverity, ConflictStatus } from "./conflict_types";
import type { ConflictStore } from "./conflict_store";

function badgeClass(sev: ConflictSeverity) {
  return sev === "critical" ? "oly-badge-warn" : sev === "warn" ? "oly-badge" : "oly-badge-ok";
}

function shortId(id: string) {
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-3)}`;
}

export function ConflictInboxPanel(props: {
  store: ConflictStore;
  onRequestSnapshot?: (peer: string) => void;
}) {
  const [status, setStatus] = useState<ConflictStatus | "any">("open");
  const [severity, setSeverity] = useState<ConflictSeverity | "any">("any");
  const [kind, setKind] = useState<ConflictKind | "any">("any");
  const [text, setText] = useState("");

  const counts = props.store.counts();

  const items = useMemo(() => {
    return props.store.list({ status, severity, kind, text, limit: 200 });
  }, [props.store, status, severity, kind, text, counts.open, counts.criticalOpen, counts.acked, counts.resolved, counts.ignored]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? props.store.get(selectedId) : undefined;

  return (
    <div className="oly-grid" style={{ gap: 12 }}>
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>Conflicts</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="oly-badge oly-badge-warn">{counts.criticalOpen} critical open</span>
            <span className="oly-badge">{counts.open} open</span>
            <span className="oly-badge">{counts.acked} acked</span>
            <span className="oly-badge">{counts.resolved} resolved</span>
            <span className="oly-badge">{counts.ignored} ignored</span>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr auto", gap: 10 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="any">Status: Any</option>
            <option value="open">open</option>
            <option value="acked">acked</option>
            <option value="resolved">resolved</option>
            <option value="ignored">ignored</option>
          </select>

          <select value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
            <option value="any">Severity: Any</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="critical">critical</option>
          </select>

          <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="any">Kind: Any</option>
            <option value="hash_mismatch">hash_mismatch</option>
            <option value="op_apply_failed">op_apply_failed</option>
            <option value="snapshot_apply_failed">snapshot_apply_failed</option>
            <option value="schema_mismatch">schema_mismatch</option>
            <option value="policy_violation">policy_violation</option>
            <option value="transport_error">transport_error</option>
            <option value="unknown">unknown</option>
          </select>

          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search title/detail…" />

          <button className="oly-btn" onClick={() => props.store.autoAckEligible()}>
            Auto-ack eligible
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 12 }}>
        <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Inbox</div>

          <div style={{ display: "grid", gap: 8, maxHeight: 520, overflow: "auto" }}>
            {!items.length ? (
              <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No conflicts match your filters.</div>
            ) : null}

            {items.map((it) => (
              <button
                key={it.id}
                className="oly-row"
                style={{
                  textAlign: "left",
                  padding: 10,
                  border: it.id === selectedId ? "2px solid var(--oly-accent)" : "1px solid var(--oly-border)",
                  borderRadius: 12,
                  background: "var(--oly-surface)",
                }}
                onClick={() => setSelectedId(it.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={`oly-badge ${badgeClass(it.severity)}`}>{it.severity.toUpperCase()}</span>
                    <span className="oly-badge">{it.kind}</span>
                    <span className="oly-badge">{it.status}</span>
                  </div>
                  <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12, color: "var(--oly-text-muted)" }}>
                    {shortId(it.id)}
                  </span>
                </div>

                <div style={{ marginTop: 6, fontWeight: 800 }}>{it.title}</div>
                {it.detail ? <div style={{ marginTop: 4, color: "var(--oly-text-muted)", fontSize: 12 }}>{it.detail}</div> : null}

                {it.sourcePeer ? (
                  <div style={{ marginTop: 6, fontFamily: "var(--oly-mono)", fontSize: 12 }}>
                    source: {it.sourcePeer}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Details</div>

          {!selected ? (
            <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>Select a conflict to view details.</div>
          ) : (
            <ConflictDetail it={selected} store={props.store} onRequestSnapshot={props.onRequestSnapshot} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConflictDetail(props: {
  it: ConflictItem;
  store: ConflictStore;
  onRequestSnapshot?: (peer: string) => void;
}) {
  const it = props.it;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span className={`oly-badge ${badgeClass(it.severity)}`}>{it.severity.toUpperCase()}</span>
        <span className="oly-badge">{it.kind}</span>
        <span className="oly-badge">{it.status}</span>
      </div>

      <div style={{ fontWeight: 900 }}>{it.title}</div>
      {it.detail ? <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>{it.detail}</div> : null}

      <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12, color: "var(--oly-text-muted)" }}>
        id: {it.id}
      </div>

      {it.sourcePeer ? (
        <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>
          sourcePeer: {it.sourcePeer}
        </div>
      ) : null}

      {it.related ? (
        <pre style={{ margin: 0, padding: 10, background: "var(--oly-surface)", borderRadius: 12, overflow: "auto" }}>
{JSON.stringify(it.related, null, 2)}
        </pre>
      ) : null}

      {it.payload ? (
        <pre style={{ margin: 0, padding: 10, background: "var(--oly-surface)", borderRadius: 12, overflow: "auto" }}>
{JSON.stringify(it.payload, null, 2)}
        </pre>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="oly-btn" onClick={() => props.store.ack(it.id)} disabled={it.status !== "open"}>
          Ack
        </button>
        <button className="oly-btn" onClick={() => props.store.resolve(it.id)} disabled={it.status === "resolved"}>
          Resolve
        </button>
        <button className="oly-btn" onClick={() => props.store.ignore(it.id)} disabled={it.status === "ignored"}>
          Ignore
        </button>

        {it.recommendedAction === "request_snapshot" && it.sourcePeer && props.onRequestSnapshot ? (
          <button className="oly-btn-primary" onClick={() => props.onRequestSnapshot?.(it.sourcePeer!)}>
            Request snapshot
          </button>
        ) : null}
      </div>
    </div>
  );
}
