// ==========================================
// COLLAB UI SHELL — A120 (HARDENED)
// Presence roster + reference peer selector.
// ==========================================

import React, { useEffect, useMemo, useState } from "react";
import type { ReferenceHashAPI } from "./reference_hash";
import { listPresence, type PresenceUser } from "./presence";

export type CollabRole = "host" | "editor" | "viewer";

export interface CollabShellProps {
  awareness: any;
  clientTag: string;
  refHashes: ReferenceHashAPI;
  getRole?: (clientTag: string) => CollabRole;
  children?: React.ReactNode;
}

export function CollabShell(props: CollabShellProps) {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [refPeer, setRefPeer] = useState<string>("");

  useEffect(() => {
    const tick = () => setUsers(listPresence(props.awareness));
    tick();

    const onChange = () => tick();
    props.awareness.on?.("change", onChange);

    const id = setInterval(tick, 1200);

    return () => {
      clearInterval(id);
      props.awareness.off?.("change", onChange);
    };
  }, [props.awareness]);

  useEffect(() => {
    const id = setInterval(() => {
      // best-effort display; API can be extended to expose ref peer directly
      void props.refHashes.getReferenceHash();
    }, 1500);
    return () => clearInterval(id);
  }, [props.refHashes]);

  const roster = useMemo(
    () =>
      users.map((u) => ({
        ...u,
        role: props.getRole?.(u.clientTag) ?? "editor",
        isSelf: u.clientTag === props.clientTag,
      })),
    [users, props.getRole, props.clientTag]
  );

  const selectablePeers = useMemo(() => roster.map((r) => r.clientTag), [roster]);

  function chooseRefPeer(ct: string) {
    setRefPeer(ct);
    props.refHashes.setReferencePeer(ct || null);
  }

  return (
    <div className="oly-card" style={{ padding: 14, background: "var(--oly-surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Collaboration</div>
        <div className="oly-badge">LIVE</div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
          <div style={{ fontSize: 12, color: "var(--oly-text-muted)" }}>Reference peer</div>
          <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center" }}>
            <select className="oly-input" value={refPeer} onChange={(e) => chooseRefPeer(e.target.value)} style={{ flex: 1 }}>
              <option value="">(none)</option>
              {selectablePeers.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>
            <button className="oly-btn" onClick={() => props.refHashes.forcePublish()} style={{ minWidth: 150 }}>
              Publish my hash
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--oly-text-muted)" }}>
            Set a trusted peer (often the host) as the reference. Hash mismatches surface in Sync Health / Conflict UI.
          </div>
        </div>

        <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
          <div style={{ fontSize: 12, color: "var(--oly-text-muted)" }}>Presence</div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {roster.map((r) => (
              <div
                key={r.clientTag}
                className="oly-row"
                style={{
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  border: "1px solid var(--oly-border)",
                  borderRadius: 10,
                  background: "var(--oly-surface)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>
                    {r.clientTag} {r.isSelf ? <span style={{ color: "var(--oly-text-muted)" }}>(you)</span> : null}
                  </div>
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                    {r.name ?? "Unnamed"} · {r.role}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="oly-badge">{r.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {props.children ? <div style={{ marginTop: 4 }}>{props.children}</div> : null}
      </div>
    </div>
  );
}
