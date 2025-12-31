// ==========================================
// CONFLICT TOASTS — A81 (HARDENED)
// Emits lightweight, dismissible toasts from ConflictBus events.
// ==========================================

import React, { useEffect, useMemo, useState } from "react";
import type { ConflictBus } from "./conflict_bus";
import type { ConflictEvent } from "./conflict_types";

export interface ConflictToastActions {
  openPanel?: (panel: string) => void;
  setReferencePeer?: (peerId: string) => void;
  forcePublishHashes?: () => Promise<void> | void;
  resyncFromCRDT?: () => Promise<void> | void;
}

interface Toast {
  event: ConflictEvent;
  seenAt: number;
}

export function ConflictToasts(props: {
  bus: ConflictBus;
  actions?: ConflictToastActions;
  max?: number;
  autoHideMs?: number;
  onSelect?: (e: ConflictEvent) => void;
}) {
  const max = props.max ?? 4;
  const autoHideMs = props.autoHideMs ?? 6500;
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const off = props.bus.on((e) => {
      setToasts((prev) => {
        const next = [{ event: e, seenAt: Date.now() }, ...prev];
        return next.slice(0, max);
      });
      props.onSelect?.(e);
    });
    return off;
  }, [props.bus, max, props.onSelect]);

  // auto-remove expired
  useEffect(() => {
    const id = setInterval(() => {
      setToasts((prev) => prev.filter((t) => Date.now() - t.seenAt < autoHideMs));
    }, 1000);
    return () => clearInterval(id);
  }, [autoHideMs]);

  const items = useMemo(() => toasts.sort((a, b) => b.event.tsMs - a.event.tsMs), [toasts]);

  if (!items.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 14,
        right: 14,
        display: "grid",
        gap: 10,
        zIndex: 1250,
      }}
    >
      {items.map((t) => (
        <ToastCard key={t.event.id} toast={t} actions={props.actions} onSelect={props.onSelect} />
      ))}
    </div>
  );
}

function ToastCard(props: { toast: Toast; actions?: ConflictToastActions; onSelect?: (e: ConflictEvent) => void }) {
  const e = props.toast.event;

  const badgeClass =
    e.severity === "error" ? "oly-badge oly-badge-err" : e.severity === "warn" ? "oly-badge oly-badge-warn" : "oly-badge";

  const shortId = e.id?.slice(0, 12) ?? "conflict";
  const time = new Date(e.tsMs || Date.now()).toLocaleTimeString();

  return (
    <div
      className="oly-card"
      style={{
        padding: 12,
        background: "var(--oly-surface2)",
        minWidth: 260,
        cursor: "pointer",
        borderLeft: `3px solid ${e.severity === "error" ? "var(--oly-err, #e74c3c)" : e.severity === "warn" ? "var(--oly-warn, #f39c12)" : "var(--oly-info, #3498db)"}`,
      }}
      onClick={() => props.onSelect?.(e)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div className={badgeClass}>{e.kind}</div>
        <div style={{ fontSize: 11, color: "var(--oly-text-muted)" }}>{time}</div>
      </div>
      <div style={{ marginTop: 6, fontWeight: 700 }}>{e.detail?.message ?? "Conflict detected"}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: "var(--oly-text-muted)" }}>{shortId}</div>

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {props.actions?.openPanel ? (
          <button className="oly-btn" onClick={() => props.actions?.openPanel?.("sync_health")}>
            Open Sync Health
          </button>
        ) : null}
        {props.actions?.resyncFromCRDT ? (
          <button className="oly-btn" onClick={() => void props.actions?.resyncFromCRDT?.()}>Resync</button>
        ) : null}
        {props.actions?.forcePublishHashes ? (
          <button className="oly-btn" onClick={() => void props.actions?.forcePublishHashes?.()}>Publish hash</button>
        ) : null}
      </div>
    </div>
  );
}
