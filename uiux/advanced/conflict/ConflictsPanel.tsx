// ==========================================
// CONFLICT INBOX UI — A124 (HARDENED)
// Renders conflict inbox with filters + drawer launch.
// ==========================================

import React, { useEffect, useMemo, useState } from "react";
import type { ConflictBus } from "./conflict_bus";
import { ConflictInboxStore, type ConflictInboxItem } from "./inbox_store";
import type { ConflictDrawerActions } from "./ConflictDetailsDrawer";
import { ConflictDetailsDrawer as ConflictDetailsDrawerV2 } from "./ConflictDetailsDrawer";

type SeverityFilter = "all" | "info" | "warn" | "err";

export function ConflictsPanel(props: {
  bus: ConflictBus;
  store: ConflictInboxStore;
  drawerActions: ConflictDrawerActions;
}) {
  const [ver, setVer] = useState(0);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [kind, setKind] = useState<string>("all");
  const [showAcked, setShowAcked] = useState<boolean>(false);

  const [selected, setSelected] = useState<ConflictInboxItem | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const off = props.bus.on((evt) => {
      props.store.push(evt as any);
      setVer((v) => v + 1);
    });
    return () => off();
  }, [props.bus, props.store]);

  const items = useMemo(() => {
    const all = props.store.getState().items;
    return all.filter((x) => {
      if (!showAcked && x.acked) return false;
      if (severity !== "all" && x.severity !== severity) return false;
      if (kind !== "all" && x.kind !== kind) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, severity, kind, showAcked]);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const x of props.store.getState().items) set.add(x.kind);
    return ["all", ...Array.from(set).sort()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver]);

  function openItem(x: ConflictInboxItem) {
    setSelected(x);
    setDrawerOpen(true);
  }

  function ackSelected() {
    if (!selected) return;
    props.store.ack(selected.id);
    setVer((v) => v + 1);
  }

  function clearAcked() {
    props.store.clearAcked();
    setVer((v) => v + 1);
  }

  function clearAll() {
    props.store.clearAll();
    setVer((v) => v + 1);
  }

  return (
    <div className="oly-card" style={{ padding: 14, background: "var(--oly-surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Conflicts</div>
        <div className="oly-badge">{items.length}</div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <div className="oly-row" style={{ gap: 10, flexWrap: "wrap" }}>
          <select className="oly-input" value={severity} onChange={(e) => setSeverity(e.target.value as any)} style={{ minWidth: 160 }}>
            <option value="all">severity: all</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="err">err</option>
          </select>

          <select className="oly-input" value={kind} onChange={(e) => setKind(e.target.value)} style={{ minWidth: 220 }}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                kind: {k}
              </option>
            ))}
          </select>

          <label className="oly-row" style={{ gap: 8 }}>
            <input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} />
            <span style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>show acked</span>
          </label>
        </div>

        <div className="oly-row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="oly-btn" onClick={ackSelected} disabled={!selected} style={{ minWidth: 140 }}>
            Ack selected
          </button>
          <button className="oly-btn" onClick={clearAcked} style={{ minWidth: 140 }}>
            Clear acked
          </button>
          <button className="oly-btn" onClick={clearAll} style={{ minWidth: 140 }}>
            Clear all
          </button>
        </div>

        <div style={{ borderTop: "1px solid var(--oly-border)", marginTop: 6 }} />

        <div style={{ display: "grid", gap: 8 }}>
          {items.map((x) => (
            <div
              key={x.id}
              className="oly-card"
              style={{
                padding: 12,
                background: x.acked ? "var(--oly-surface2)" : "var(--oly-surface)",
                border: "1px solid var(--oly-border)",
                cursor: "pointer",
              }}
              onClick={() => openItem(x)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>
                  {x.kind} <span style={{ color: "var(--oly-text-muted)", fontWeight: 600 }}>· {new Date(x.tsMs).toLocaleString()}</span>
                </div>
                <div className={`oly-badge oly-badge-${x.severity === "err" ? "err" : x.severity === "warn" ? "warn" : "ok"}`}>
                  {x.severity.toUpperCase()}
                </div>
              </div>

              <div style={{ marginTop: 8, color: "var(--oly-text-muted)", fontSize: 13 }}>
                {x.detail?.message ?? "(no message)"}
              </div>

              <div style={{ marginTop: 8, fontFamily: "var(--oly-mono)", fontSize: 12, color: "var(--oly-text-muted)" }}>
                id: {x.id}
              </div>
            </div>
          ))}

          {!items.length ? <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No conflicts.</div> : null}
        </div>
      </div>

      <ConflictDetailsDrawerV2 open={drawerOpen} conflict={selected as any} onClose={() => setDrawerOpen(false)} actions={props.drawerActions} />
    </div>
  );
}
