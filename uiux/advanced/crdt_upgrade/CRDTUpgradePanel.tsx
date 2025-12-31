// ==========================================
// CRDT UPGRADE PANEL — A220 (HARDENED)
// FILE: uiux/advanced/crdt_upgrade/CRDTUpgradePanel.tsx
// Host-driven: propose/apply. Others: vote.
// ==========================================

import React, { useMemo, useState } from "react";
import type { UpgradeSnapshot } from "./upgrade_types";
import type { CRDTMeta } from "./upgrade_types";
import { MigrationRegistry } from "./upgrade_registry";

export function CRDTUpgradePanel<State>(props: {
  snap: UpgradeSnapshot;
  localMeta?: CRDTMeta;

  // role context
  role: "host" | "editor" | "viewer";
  isCollaborative: boolean;

  // actions
  onPropose?: (toSchema: string) => Promise<void>;
  onVote?: (vote: "approve" | "reject", reason?: string) => Promise<void>;
  onApply?: () => Promise<void>;

  // optional: show available targets from registry
  registry?: MigrationRegistry<State>;
}) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");

  const proposal = props.snap.proposal;
  const votes = props.snap.votes ?? [];
  const status = props.snap.status;

  const availableTargets = useMemo(() => {
    if (!props.registry || !props.localMeta) return [];
    const from = props.localMeta.schemaVersion;
    const steps = props.registry.list();
    const tos = new Set<string>();
    for (const s of steps) if (s.from === from) tos.add(s.to);
    return [...tos].sort();
  }, [props.registry, props.localMeta?.schemaVersion]);

  return (
    <div className="oly-grid" style={{ gap: 12 }}>
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>CRDT Upgrade</div>
          <span className="oly-badge">{props.snap.phase}</span>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span className="oly-badge">role: {props.role}</span>
          <span className="oly-badge">collab: {props.isCollaborative ? "yes" : "no"}</span>
          <span className="oly-badge">local schema: {props.localMeta?.schemaVersion ?? "—"}</span>
        </div>
      </div>

      {/* Propose */}
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ fontWeight: 900 }}>Propose upgrade</div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={availableTargets.length ? `e.g. ${availableTargets.join(", ")}` : "target schema version"}
            />
            {availableTargets.length ? (
              <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                available next targets from current schema: {availableTargets.join(", ")}
              </div>
            ) : null}
          </div>

          <button
            className="oly-btn-primary"
            disabled={!props.onPropose || !target || (props.isCollaborative && props.role !== "host")}
            onClick={() => void props.onPropose?.(target)}
          >
            Propose
          </button>
        </div>

        {props.isCollaborative && props.role !== "host" ? (
          <div style={{ marginTop: 8, color: "var(--oly-text-muted)", fontSize: 12 }}>
            Only host can propose upgrades in collaborative mode.
          </div>
        ) : null}
      </div>

      {/* Active proposal */}
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ fontWeight: 900 }}>Active proposal</div>

        {!proposal ? (
          <div style={{ marginTop: 8, color: "var(--oly-text-muted)", fontSize: 13 }}>No active proposal.</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span className="oly-badge">id: {proposal.proposalId}</span>
              <span className="oly-badge">from: {proposal.plan.from}</span>
              <span className="oly-badge">to: {proposal.plan.to}</span>
              <span className="oly-badge">plan: {proposal.plan.planId}</span>
            </div>

            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Steps</div>
              <div style={{ display: "grid", gap: 6 }}>
                {proposal.plan.steps.map((s) => (
                  <div key={s.id} className="oly-row">
                    <span className="oly-badge">{s.id}</span>
                    <span style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                      {s.from} → {s.to}
                    </span>
                    <span style={{ fontWeight: 700 }}>{s.description}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Voting */}
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 800 }}>Votes</div>

              <div className="oly-row" style={{ gap: 10 }}>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="optional reason"
                  style={{ flex: 1 }}
                />

                <button
                  className="oly-btn"
                  disabled={!props.onVote}
                  onClick={() => void props.onVote?.("reject", reason || undefined)}
                >
                  Reject
                </button>

                <button
                  className="oly-btn-primary"
                  disabled={!props.onVote}
                  onClick={() => void props.onVote?.("approve", reason || undefined)}
                >
                  Approve
                </button>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                {!votes.length ? (
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No votes recorded yet.</div>
                ) : null}
                {votes.map((v) => (
                  <div key={v.from} className="oly-row">
                    <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{v.from}</span>
                    <span className={`oly-badge ${v.vote === "approve" ? "oly-badge-ok" : "oly-badge-warn"}`}>
                      {v.vote.toUpperCase()}
                    </span>
                    {v.reason ? <span style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>{v.reason}</span> : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Apply (host) */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                className="oly-btn-primary"
                disabled={!props.onApply || (props.isCollaborative && props.role !== "host")}
                onClick={() => void props.onApply?.()}
              >
                Apply (host)
              </button>
            </div>

            {status ? (
              <pre style={{ margin: 0, padding: 10, background: "var(--oly-surface)", borderRadius: 12, overflow: "auto" }}>
{JSON.stringify(status, null, 2)}
              </pre>
            ) : null}
          </div>
        )}
      </div>

      {/* Peer overview */}
      <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
        <div style={{ fontWeight: 900 }}>Peer schema status</div>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {!props.snap.peers.length ? (
            <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No peer meta yet.</div>
          ) : null}
          {props.snap.peers.map((p) => (
            <div key={p.clientTag} className="oly-row">
              <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>{p.clientTag}</span>
              <span className="oly-badge">{p.schemaVersion ?? "—"}</span>
              <span style={{ fontFamily: "var(--oly-mono)", fontSize: 12, color: "var(--oly-text-muted)" }}>
                {p.stateHash ? `${p.stateHash.slice(0, 6)}…${p.stateHash.slice(-4)}` : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
