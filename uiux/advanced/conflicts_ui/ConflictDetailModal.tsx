// ==========================================
// CONFLICT DETAIL MODAL — A232 (HARDENED)
// FILE: uiux/advanced/conflicts_ui/ConflictDetailModal.tsx
// Provides: ack/ignore/request snapshot/keep local/accept remote/manual merge.
// Includes snapshot diff view if payload has { local, remote }.
// ==========================================

import React, { useMemo, useState } from "react";
import type { AuditLogger, ConflictRecord, ConflictUIAdapter } from "./conflict_ui_types";
import { diffLines, stablePrettyJSON } from "./diff_utils";

export function ConflictDetailModal(props: {
  open: boolean;
  onClose: () => void;

  conflictId: string | null;

  adapter: ConflictUIAdapter;
  audit?: AuditLogger;
}) {
  const c = props.conflictId ? props.adapter.get(props.conflictId) : undefined;

  const [note, setNote] = useState("");
  const [mergeText, setMergeText] = useState("");

  const snap = useMemo(() => {
    if (!c?.payload) return null;

    // convention: payload.local / payload.remote are comparable objects
    const local = c.payload.local ?? c.payload.localSnapshot ?? null;
    const remote = c.payload.remote ?? c.payload.remoteSnapshot ?? null;
    if (!local || !remote) return null;

    const left = stablePrettyJSON(local);
    const right = stablePrettyJSON(remote);

    return { local, remote, left, right, diff: diffLines(left, right) };
  }, [c?.payload]);

  if (!props.open) return null;

  return (
    <div className="oly-modal-backdrop" onMouseDown={props.onClose}>
      <div className="oly-modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 980, maxWidth: "96vw" }}>
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>Conflict Detail</div>
            <button className="oly-btn" onClick={props.onClose}>Close</button>
          </div>

          {!c ? (
            <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No conflict selected.</div>
          ) : (
            <>
              <Header c={c} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="oly-card" style={{ padding: 10, background: "var(--oly-surface2)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Detail</div>
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>{c.detail ?? "—"}</div>

                  <div style={{ marginTop: 10, fontWeight: 800 }}>Payload</div>
                  <pre style={{ margin: 0, padding: 10, borderRadius: 12, background: "var(--oly-surface)", overflow: "auto", maxHeight: 220 }}>
{JSON.stringify(c.payload ?? {}, null, 2)}
                  </pre>
                </div>

                <div className="oly-card" style={{ padding: 10, background: "var(--oly-surface2)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Actions</div>

                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional note" />

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <button className="oly-btn" onClick={() => void act(props, c, "ack", note)}>Ack</button>
                    <button className="oly-btn" onClick={() => void act(props, c, "ignore", note)}>Ignore</button>

                    {c.sourcePeer && props.adapter.requestSnapshot ? (
                      <button className="oly-btn-primary" onClick={() => void act(props, c, "requestSnapshot", note)}>
                        Request snapshot ({c.sourcePeer})
                      </button>
                    ) : null}

                    {props.adapter.keepLocal ? (
                      <button className="oly-btn" onClick={() => void act(props, c, "keepLocal", note)}>
                        Keep local
                      </button>
                    ) : null}

                    {props.adapter.acceptRemote ? (
                      <button className="oly-btn" onClick={() => void act(props, c, "acceptRemote", note)}>
                        Accept remote
                      </button>
                    ) : null}
                  </div>

                  {props.adapter.manualMerge ? (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      <div style={{ fontWeight: 800 }}>Manual merge</div>
                      <textarea
                        value={mergeText}
                        onChange={(e) => setMergeText(e.target.value)}
                        placeholder='Paste merged JSON (object). If empty, uses payload.merged if provided.'
                        style={{ height: 120 }}
                      />
                      <button
                        className="oly-btn-primary"
                        onClick={() => void act(props, c, "manualMerge", note, mergeText)}
                      >
                        Apply manual merge
                      </button>
                      <div style={{ color: "var(--oly-text-muted)", fontSize: 12 }}>
                        Manual merge is audited; invalid JSON is rejected.
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Diff viewer */}
              <div className="oly-card" style={{ padding: 10, background: "var(--oly-surface2)" }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Diff</div>

                {!snap ? (
                  <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>
                    No diff available. To enable, set conflict.payload.local and conflict.payload.remote.
                  </div>
                ) : (
                  <DiffViewer leftTitle="local" rightTitle="remote" diff={snap.diff} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Header(props: { c: ConflictRecord }) {
  const c = props.c;
  const badge =
    c.severity === "critical" ? "oly-badge-warn" : c.severity === "warn" ? "oly-badge" : "oly-badge-ok";

  return (
    <div className="oly-card" style={{ padding: 10, background: "var(--oly-surface2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 900 }}>{c.title}</div>
        <span className={`oly-badge ${badge}`}>{c.severity.toUpperCase()}</span>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span className="oly-badge">id: {c.id}</span>
        <span className="oly-badge">kind: {c.kind}</span>
        <span className="oly-badge">status: {c.status}</span>
        {c.sourcePeer ? <span className="oly-badge">peer: {c.sourcePeer}</span> : null}
        {c.recommendedAction ? <span className="oly-badge">hint: {c.recommendedAction}</span> : null}
      </div>
    </div>
  );
}

function DiffViewer(props: { leftTitle: string; rightTitle: string; diff: Array<{ op: string; left?: string; right?: string }> }) {
  const rows = props.diff.slice(0, 2000);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div style={{ border: "1px solid var(--oly-border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 8, background: "var(--oly-surface)", fontWeight: 800 }}>{props.leftTitle}</div>
        <pre style={{ margin: 0, padding: 10, maxHeight: 360, overflow: "auto" }}>
{rows.map((r, i) => renderLine(i, r.op, "left", r.left)).join("\n")}
        </pre>
      </div>

      <div style={{ border: "1px solid var(--oly-border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 8, background: "var(--oly-surface)", fontWeight: 800 }}>{props.rightTitle}</div>
        <pre style={{ margin: 0, padding: 10, maxHeight: 360, overflow: "auto" }}>
{rows.map((r, i) => renderLine(i, r.op, "right", r.right)).join("\n")}
        </pre>
      </div>
    </div>
  );
}

function renderLine(i: number, op: string, side: "left" | "right", text?: string): string {
  // Using ASCII markers rather than color to keep this UI theme-agnostic.
  if (op === "equal") return `${pad(i)}  ${text ?? ""}`;
  if (op === "delete") return side === "left" ? `${pad(i)} -${text ?? ""}` : `${pad(i)}  `;
  if (op === "insert") return side === "right" ? `${pad(i)} +${text ?? ""}` : `${pad(i)}  `;
  return `${pad(i)}  ${text ?? ""}`;
}

function pad(i: number) {
  const s = String(i + 1);
  return s.length >= 4 ? s : " ".repeat(4 - s.length) + s;
}

async function act(
  props: { adapter: ConflictUIAdapter; audit?: AuditLogger; onClose: () => void },
  c: ConflictRecord,
  kind: "ack" | "ignore" | "requestSnapshot" | "keepLocal" | "acceptRemote" | "manualMerge",
  note?: string,
  mergeText?: string
) {
  const audit = props.audit;

  const log = async (ok: boolean, payload: any) => {
    await audit?.log("conflict", `conflict.${kind}`, ok, payload);
  };

  try {
    if (kind === "ack") {
      await props.adapter.ack(c.id, note);
      await log(true, { id: c.id, note });
      props.onClose();
      return;
    }

    if (kind === "ignore") {
      await props.adapter.ignore(c.id, note);
      await log(true, { id: c.id, note });
      props.onClose();
      return;
    }

    if (kind === "requestSnapshot") {
      if (!c.sourcePeer || !props.adapter.requestSnapshot) throw new Error("missing sourcePeer or requestSnapshot");
      await props.adapter.requestSnapshot(c.sourcePeer, note);
      await log(true, { id: c.id, peer: c.sourcePeer, note });
      return;
    }

    if (kind === "keepLocal") {
      if (!props.adapter.keepLocal) throw new Error("keepLocal not supported");
      await props.adapter.keepLocal(c.id, note);
      await log(true, { id: c.id, note });
      props.onClose();
      return;
    }

    if (kind === "acceptRemote") {
      if (!props.adapter.acceptRemote) throw new Error("acceptRemote not supported");
      await props.adapter.acceptRemote(c.id, note);
      await log(true, { id: c.id, note });
      props.onClose();
      return;
    }

    if (kind === "manualMerge") {
      if (!props.adapter.manualMerge) throw new Error("manualMerge not supported");

      let merged: any | undefined = undefined;

      const t = (mergeText ?? "").trim();
      if (t) {
        merged = JSON.parse(t);
      } else if (c.payload?.merged) {
        merged = c.payload.merged;
      }

      await props.adapter.manualMerge(c.id, merged, note);
      await log(true, { id: c.id, note, hasMerged: merged != null });
      props.onClose();
      return;
    }
  } catch (e: any) {
    const err = String(e?.message ?? e);
    await log(false, { id: c.id, error: err });
    // keep modal open so user can adjust
  }
}
