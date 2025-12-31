// ==========================================
// XR WORKSPACE STUB — A251 (HARDENED)
// FILE: uiux/advanced/xr/XRWorkspace.tsx
// Stub that can render the same project graph/state in 3D later.
// For now: shows mode + live input echo + target selection.
// ==========================================

import React, { useEffect, useMemo, useState } from "react";
import type { XRAdapter, XRInputEvent, XRMode } from "./xr_types";

export function XRWorkspace(props: {
  adapter: XRAdapter;

  // core app state: pass whatever your graph is (morphology, routing, sim, etc.)
  projectSummary?: any;

  mode: XRMode;
  onExit: () => void;
}) {
  const [viewportTick, setViewportTick] = useState(0);
  const [lastInput, setLastInput] = useState<XRInputEvent | null>(null);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      await props.adapter.start(props.mode);
      if (!mounted) return;
      setViewportTick((x) => x + 1);
    })();

    const off = props.adapter.onInput((e) => setLastInput(e));
    const offFrame = props.adapter.onFrame?.((_) => setViewportTick((x) => x + 1));

    return () => {
      mounted = false;
      off();
      offFrame?.();
      void props.adapter.stop();
    };
  }, [props.adapter, props.mode]);

  const vp = useMemo(() => props.adapter.getViewport(), [props.adapter, viewportTick]);

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>XR Workspace</div>
        <button className="oly-btn" onClick={props.onExit}>Exit</button>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span className="oly-badge">mode: {vp.mode}</span>
        <span className="oly-badge">worldScale: {vp.worldScale}</span>
        {vp.widthPx && vp.heightPx ? <span className="oly-badge">{vp.widthPx}×{vp.heightPx}px</span> : null}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="oly-card" style={{ padding: 10, background: "var(--oly-surface)" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Project summary</div>
          <pre style={{ margin: 0, maxHeight: 260, overflow: "auto" }}>
{JSON.stringify(props.projectSummary ?? { note: "pass project state summary here" }, null, 2)}
          </pre>
        </div>

        <div className="oly-card" style={{ padding: 10, background: "var(--oly-surface)" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Last input</div>
          {!lastInput ? (
            <div style={{ color: "var(--oly-text-muted)", fontSize: 13 }}>No XR input yet.</div>
          ) : (
            <pre style={{ margin: 0, maxHeight: 260, overflow: "auto" }}>
{JSON.stringify(lastInput, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10, color: "var(--oly-text-muted)", fontSize: 12 }}>
        This stub is intentionally non-invasive: XR only emits input events; core state remains CRDT-driven.
      </div>
    </div>
  );
}
