// ==========================================
// ROBUSTNESS GATES CONFIG PANEL — A100 (HARDENED)
// UI writes policy to state path: policy.robustness_gates
// ==========================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { RobustnessGatesPolicy, Gate } from "./robustness_gates";
import { DEFAULT_ROBUSTNESS_GATES, validateRobustnessGates } from "./robustness_gates";

type SetValueFn = (path: string, value: any) => void;

export function RobustnessGatesPanel(props: {
  // read current from your store/CRDT projection
  current?: RobustnessGatesPolicy;
  setValue: SetValueFn; // store.api.setValue
  statePath?: string;   // default "policy.robustness_gates"
}) {
  const path = props.statePath ?? "policy.robustness_gates";
  const [draft, setDraft] = useState<RobustnessGatesPolicy>(props.current ?? DEFAULT_ROBUSTNESS_GATES);
  const [dirty, setDirty] = useState(false);

  // keep draft aligned if upstream changes and we're not editing
  useEffect(() => {
    if (dirty) return;
    if (props.current) setDraft(props.current);
  }, [props.current, dirty]);

  const issues = useMemo(() => validateRobustnessGates(draft), [draft]);
  const ok = issues.length === 0;

  // debounce writes to avoid CRDT spam
  const timer = useRef<any>(null);
  useEffect(() => {
    if (!dirty) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      props.setValue(path, draft);
      setDirty(false);
    }, 250);
    return () => clearTimeout(timer.current);
  }, [dirty, draft, path, props.setValue]);

  function mutate(fn: (p: RobustnessGatesPolicy) => RobustnessGatesPolicy) {
    setDraft((p) => fn(p));
    setDirty(true);
  }

  return (
    <div className="oly-card" style={{ padding: 14, background: "var(--oly-surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 850, fontSize: 16 }}>Robustness Gates (Policy)</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="oly-btn" onClick={() => { setDraft(DEFAULT_ROBUSTNESS_GATES); setDirty(true); }} style={{ minWidth: 140 }}>
            Reset defaults
          </button>
          <button className="oly-btn-primary" disabled={!ok} onClick={() => { props.setValue(path, draft); setDirty(false); }} style={{ minWidth: 140 }}>
            Apply now
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, color: "var(--oly-text-muted)", fontSize: 13 }}>
        These gates filter candidates during Monte Carlo / optimization selection. They are policy and should not be hard-coded in pipelines.
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <ToggleRow
          label="Policy enabled"
          value={draft.enabled}
          onChange={(v) => mutate((p) => ({ ...p, enabled: v }))}
        />
        <ToggleRow
          label="Require ALL enabled gates"
          value={draft.requireAll}
          onChange={(v) => mutate((p) => ({ ...p, requireAll: v }))}
        />
      </div>

      <div style={{ marginTop: 14, borderTop: "1px solid var(--oly-border)" }} />

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {draft.gates.map((g, i) => (
          <GateRow
            key={`${g.metric}:${g.tag ?? ""}:${i}`}
            gate={g}
            onChange={(ng) =>
              mutate((p) => {
                const next = structuredClone(p);
                next.gates[i] = ng;
                return next;
              })
            }
            onDelete={() =>
              mutate((p) => {
                const next = structuredClone(p);
                next.gates.splice(i, 1);
                return next;
              })
            }
          />
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <button
          className="oly-btn"
          onClick={() =>
            mutate((p) => ({
              ...p,
              gates: [
                ...p.gates,
                { enabled: true, metric: "new_metric", op: "<=", value: 0, unit: "", note: "" },
              ],
            }))
          }
          style={{ minWidth: 140 }}
        >
          Add gate
        </button>

        <button className="oly-btn" onClick={() => void copyJson(draft)} style={{ minWidth: 140 }}>
          Copy JSON
        </button>
      </div>

      {!ok ? (
        <div style={{ marginTop: 12 }}>
          <div className="oly-badge oly-badge-err">Invalid policy</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {issues.map((x, idx) => (
              <div key={idx} style={{ fontFamily: "var(--oly-mono)", fontSize: 12 }}>
                {x.path}: {x.message}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="oly-badge oly-badge-ok">Valid</div>
        </div>
      )}
    </div>
  );
}

function GateRow(props: { gate: Gate; onChange(g: Gate): void; onDelete(): void }) {
  const g = props.gate;

  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={g.enabled}
            onChange={(e) => props.onChange({ ...g, enabled: e.target.checked })}
            style={{ width: 18, height: 18 }}
          />
          <div style={{ fontWeight: 750 }}>
            {g.metric}
            {g.tag ? <span style={{ color: "var(--oly-text-muted)" }}> · {g.tag}</span> : null}
          </div>
        </div>

        <button className="oly-btn" onClick={props.onDelete} style={{ minWidth: 96 }}>
          Remove
        </button>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 110px 120px 110px", gap: 10 }}>
        <Field
          label="metric"
          value={g.metric}
          onChange={(v) => props.onChange({ ...g, metric: v })}
        />
        <Select
          label="tag"
          value={g.tag ?? ""}
          options={[
            ["", "(none)"],
            ["q10", "q10"],
            ["q90", "q90"],
            ["cvar95_upper", "cvar95_upper"],
          ]}
          onChange={(v) => props.onChange({ ...g, tag: (v || undefined) as any })}
        />
        <Select
          label="op"
          value={g.op}
          options={[
            ["<=", "<="],
            [">=", ">="],
          ]}
          onChange={(v) => props.onChange({ ...g, op: v as any })}
        />
        <NumberField
          label="value"
          value={g.value}
          onChange={(n) => props.onChange({ ...g, value: n })}
        />
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "140px 1fr", gap: 10 }}>
        <Field label="unit" value={g.unit ?? ""} onChange={(v) => props.onChange({ ...g, unit: v })} />
        <Field label="note" value={g.note ?? ""} onChange={(v) => props.onChange({ ...g, note: v })} />
      </div>
    </div>
  );
}

function ToggleRow(props: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <div className="oly-card" style={{ padding: 12, background: "var(--oly-surface2)", display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>{props.label}</div>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} style={{ width: 18, height: 18 }} />
    </div>
  );
}

function Field(props: { label: string; value: string; onChange(v: string): void }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, color: "var(--oly-text-muted)" }}>{props.label}</div>
      <input className="oly-input" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}

function NumberField(props: { label: string; value: number; onChange(v: number): void }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, color: "var(--oly-text-muted)" }}>{props.label}</div>
      <input
        className="oly-input"
        inputMode="decimal"
        value={String(props.value)}
        onChange={(e) => props.onChange(safeNum(e.target.value, props.value))}
      />
    </div>
  );
}

function Select(props: { label: string; value: string; options: Array<[string, string]>; onChange(v: string): void }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, color: "var(--oly-text-muted)" }}>{props.label}</div>
      <select className="oly-input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

function safeNum(s: string, fallback: number): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

async function copyJson(x: any) {
  const text = JSON.stringify(x, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // no-op
  }
}
