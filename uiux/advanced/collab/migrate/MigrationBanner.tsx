// ==========================================
// UI MIGRATION BANNER — A90 (HARDENED)
// Non-blocking top banner for schema mismatch / migration status.
// ==========================================

import React, { useEffect, useMemo, useState } from "react";
import type { ConflictBus } from "../../conflict/conflict_bus";
import type { ConflictEvent } from "../../conflict/conflict_types";

type BannerMode = "hidden" | "migrating" | "ok" | "failed";

export interface MigrationBannerProps {
  bus: ConflictBus;
  room?: string;
  docId?: string;
  autoHideOkMs?: number; // default 3500
}

interface BannerState {
  mode: BannerMode;
  message: string;
  tsMs: number;
}

function matchDoc(e: ConflictEvent, room?: string, docId?: string): boolean {
  if (room && e.room && e.room !== room) return false;
  if (docId && e.docId && e.docId !== docId) return false;
  return true;
}

export function MigrationBanner(props: MigrationBannerProps) {
  const [st, setSt] = useState<BannerState>({ mode: "hidden", message: "", tsMs: 0 });
  const autoHideOkMs = props.autoHideOkMs ?? 3500;

  const bg = useMemo(() => {
    if (st.mode === "migrating") return "rgba(243,156,18,0.18)"; // warn
    if (st.mode === "ok") return "rgba(46,204,113,0.18)"; // ok
    if (st.mode === "failed") return "rgba(231,76,60,0.18)"; // err
    return "transparent";
  }, [st.mode]);

  const border = useMemo(() => {
    if (st.mode === "migrating") return "rgba(243,156,18,0.40)";
    if (st.mode === "ok") return "rgba(46,204,113,0.40)";
    if (st.mode === "failed") return "rgba(231,76,60,0.40)";
    return "transparent";
  }, [st.mode]);

  useEffect(() => {
    const off = props.bus.on((e) => {
      if (!matchDoc(e, props.room, props.docId)) return;

      // emitted by migrate_on_connect.ts:
      // - version_mismatch:* (warn, kind transport)
      // - migration_ok:*    (info, kind transport)
      // - migration_failed:* (error, kind transport)
      const id = String(e.id ?? "");
      const msg = e.detail?.message ?? "";

      if (id.startsWith("version_mismatch:")) {
        setSt({ mode: "migrating", message: msg || "Schema mismatch detected. Migrating…", tsMs: Date.now() });
        return;
      }
      if (id.startsWith("migration_ok:")) {
        setSt({ mode: "ok", message: msg || "Migration complete.", tsMs: Date.now() });
        return;
      }
      if (id.startsWith("migration_failed:")) {
        setSt({ mode: "failed", message: msg || "Migration failed.", tsMs: Date.now() });
        return;
      }
    });

    return off;
  }, [props.bus, props.room, props.docId]);

  useEffect(() => {
    if (st.mode !== "ok") return;
    const id = setTimeout(() => {
      setSt((prev) => (prev.mode === "ok" ? { mode: "hidden", message: "", tsMs: 0 } : prev));
    }, autoHideOkMs);
    return () => clearTimeout(id);
  }, [st.mode, autoHideOkMs]);

  if (st.mode === "hidden") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1400,
        padding: "10px 14px",
        borderBottom: `1px solid ${border}`,
        background: bg,
        backdropFilter: "blur(10px)",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <Badge mode={st.mode} />
      <div style={{ fontSize: 13, color: "var(--oly-text)" }}>{st.message}</div>
      <div style={{ marginLeft: "auto" }}>
        <button className="oly-btn" onClick={() => setSt({ mode: "hidden", message: "", tsMs: 0 })} style={{ minWidth: 96 }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Badge(props: { mode: BannerMode }) {
  const label =
    props.mode === "migrating" ? "MIGRATING" : props.mode === "ok" ? "UPDATED" : props.mode === "failed" ? "FAILED" : "";

  const cls =
    props.mode === "migrating"
      ? "oly-badge oly-badge-warn"
      : props.mode === "ok"
        ? "oly-badge oly-badge-ok"
        : "oly-badge oly-badge-err";

  return <div className={cls}>{label}</div>;
}
