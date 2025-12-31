// ==========================================
// PRESENCE STRIP UI — A189 (HARDENED)
// FILE: uiux/advanced/presence/PresenceStrip.tsx
// Compact peer status bar with RTT + hash short.
// ==========================================

import React from "react";
import type { PresenceSnapshot, PresencePeer } from "./presence_types";

function shortHash(h?: string) {
  if (!h) return "";
  return h.length <= 10 ? h : `${h.slice(0, 5)}…${h.slice(-3)}`;
}

export function PresenceStrip(props: {
  snap: PresenceSnapshot;
  onPingPeer?: (clientTag: string) => void;
}) {
  return (
    <div className="oly-card" style={{ padding: 10, background: "var(--oly-surface2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 900 }}>Presence</div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="oly-badge oly-badge-ok">{props.snap.onlineCount} online</span>
          <span className="oly-badge">{props.snap.awayCount} away</span>
          <span className="oly-badge">{props.snap.offlineCount} offline</span>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <PeerRow peer={props.snap.local} isLocal onPingPeer={props.onPingPeer} />
        {props.snap.peers.map((p) => (
          <PeerRow key={p.clientTag} peer={p} onPingPeer={props.onPingPeer} />
        ))}
        {!props.snap.peers.length ? (
          <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No peers detected.</div>
        ) : null}
      </div>
    </div>
  );
}

function PeerRow(props: {
  peer: PresencePeer;
  isLocal?: boolean;
  onPingPeer?: (clientTag: string) => void;
}) {
  const badge =
    props.peer.status === "online" ? "oly-badge-ok" : props.peer.status === "away" ? "oly-badge" : "oly-badge-warn";

  return (
    <div className="oly-row" style={{ alignItems: "center" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className={`oly-badge ${badge}`}>{props.peer.status.toUpperCase()}</span>
        <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>
          {props.isLocal ? `${props.peer.clientTag} (you)` : props.peer.clientTag}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {props.peer.rttMs != null ? (
          <span className="oly-badge">{props.peer.rttMs} ms</span>
        ) : (
          <span style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>—</span>
        )}

        {props.peer.stateHash ? (
          <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12, color: "var(--oly-text-muted)" }}>
            {shortHash(props.peer.stateHash)}
          </span>
        ) : null}

        {!props.isLocal && props.onPingPeer ? (
          <button className="oly-btn" onClick={() => props.onPingPeer?.(props.peer.clientTag)}>
            Ping
          </button>
        ) : null}
      </div>
    </div>
  );
}
