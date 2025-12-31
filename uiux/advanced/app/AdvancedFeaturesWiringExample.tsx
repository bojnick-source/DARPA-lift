// ==========================================
// END-TO-END WIRING EXAMPLE — A60 (HARDENED)
// Demonstrates full chain:
//   NLCommandBar -> AIProvider -> SandboxedExecutor
//   -> (CRDT bridge exec) -> role guard
//   -> approval modal + audit logger
//   -> sync health panel + divergence watcher
// ==========================================

import React, { useEffect, useMemo, useState } from "react";

import { NLCommandBar } from "../nl/NLCommandBar";
import { createModalApprovalGate } from "../ai/approval_gate_ui";
import { SandboxedExecutor } from "../ai/sandboxed_executor";
import { DEFAULT_TOOLCALL_POLICY } from "../ai/toolcall_policy";

import { CollabProvider } from "../collab/crdt/collab_provider";
import { getYRoot } from "../collab/crdt/yjs_types";
import { ReferenceHashChannel } from "../health/reference_hash_channel";
import { SyncHealthPanel } from "../sync/SyncHealthPanel";

import { createNLCrdtCommandExec } from "../nl/nl_crdt_bridge";
import { withRoleGuard } from "../nl/nl_role_guard";
import type { Role } from "../auth/roles";
import type { CommandHandlers } from "../nl/command_executor";
import type { CommandContext } from "../nl/command_types";
import type { SyncHealthSnapshot } from "../sync/sync_health_types";

import { AuditLogger } from "../audit/audit_logger";
import { MemorySink } from "../audit/sinks";
import { makeNLAuditHook, wrapPipelineRunner } from "../audit/integrations";
import { DEFAULT_NL_POLICY } from "../nl/bindings";

// --- Minimal UI store (replace with Zustand/Redux/etc.) ---
function useSimpleStore() {
  const [state, setState] = useState<any>({});
  return {
    state,
    api: {
      setValue(path: string, value: any) {
        setState((prev: any) => {
          const next = structuredClone(prev);
          const parts = path.split(".").filter(Boolean);
          let cur = next;
          for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
            cur = cur[k];
          }
          cur[parts[parts.length - 1]] = value;
          return next;
        });
      },
    },
  };
}

// --- Placeholder AI provider (replace with your real model call) ---
const DemoAIProvider = {
  async call(req: any) {
    // Example translation: "run monte carlo"
    const t = String(req?.context?.userText ?? "").toLowerCase();
    if (t.includes("monte")) {
      return {
        text: "Running Monte Carlo…",
        actions: [{ type: "run_pipeline", pipeline: "run_monte_carlo" }],
      };
    }
    if (t.includes("open optimize")) {
      return { text: "Opening optimize panel…", actions: [{ type: "open_panel", panel: "optimize" }] };
    }
    if (t.includes("set")) {
      return { text: "Setting a parameter…", actions: [{ type: "set_value", path: "opt.popsize", value: 24 }] };
    }
    return { text: "No actionable intent detected.", actions: [] };
  },
};

export function AdvancedFeaturesWiringExample() {
  // ---- role (wire from auth) ----
  const role: Role = "admin";

  // ---- UI store ----
  const store = useSimpleStore();

  // ---- Audit logger (swap MemorySink -> NodeFileSink or BrowserDownloadSink) ----
  const auditSink = useMemo(() => new MemorySink(), []);
  const audit = useMemo(
    () =>
      new AuditLogger({
        sessionId: `sess_${Date.now()}`,
        clientId: `client_${Math.random().toString(16).slice(2)}`,
        sink: auditSink,
        enableHashChain: true,
      }),
    [auditSink]
  );

  // ---- Panels + Pipelines (wire to real app) ----
  const panels = useMemo(
    () => ({
      open(panel: any) {
        // no-op demo
        void audit.log("nl.actions", true, { opened: panel });
      },
    }),
    [audit]
  );

  const pipelines = useMemo(
    () => ({
      async run(p: any) {
        // demo simulated run
        await new Promise((r) => setTimeout(r, 250));
        void audit.log("pipeline.ok", true, { pipeline: p });
      },
    }),
    [audit]
  );

  // ---- Collab/CRDT ----
  const collab = useMemo(
    () =>
      new CollabProvider({
        url: "ws://localhost:8787", // your y-websocket endpoint
        room: "olytheon-main",
        connect: true,
        presence: { user: { id: "robert", name: "Robert", role } },
      }),
    [role]
  );

  // ---- Reference hash broadcast ----

  const root = useMemo(() => getYRoot(collab.crdt.doc), [collab]);
  const refChan = useMemo(
    () =>
      new ReferenceHashChannel({
        meta: root.meta as any,
        clientTag: (audit as any).opts?.clientId ?? "local",
        getLocalState: () => store.state,
      }),
    [root.meta, store.state, audit]
  );

  useEffect(() => {
    refChan.start();
    return () => refChan.stop();
  }, [refChan]);

  // ---- Build execution chain: CRDT exec -> role guard -> sandbox -> approval gate ----
  const nlAudit = useMemo(() => makeNLAuditHook(audit), [audit]);

  const guardedExec = useMemo(() => {
    // Wrap pipelines with audit
    const auditedPipelines = { run: wrapPipelineRunner(audit, pipelines.run) };

    // CRDT source-of-truth exec
    const crdtExec = createNLCrdtCommandExec({
      crdt: collab.crdt,
      uiState: store.api,
      panels,
      pipelines: auditedPipelines as any,
      policy: DEFAULT_NL_POLICY,
      audit: (e) => nlAudit(e as any),
    });

    // Role guard on top
    return withRoleGuard(crdtExec, { role, audit: (e) => nlAudit(e as any) });
  }, [audit, pipelines.run, collab.crdt, store.api, panels, role, nlAudit]);

  const { gate: approvalGate, UI: ApprovalUI } = useMemo(
    () =>
      createModalApprovalGate({
        costlyPipelines: DEFAULT_TOOLCALL_POLICY.confirm.pipelines,
      }),
    []
  );

  const sandbox = useMemo(
    () =>
      new SandboxedExecutor({
        exec: guardedExec,
        approval: approvalGate,
        policy: DEFAULT_TOOLCALL_POLICY,
        audit: (e) => nlAudit(e as any),
      }),
    [guardedExec, approvalGate, nlAudit]
  );

  // ---- Sync health snapshot (demo) ----
  const syncSnap = useMemo<SyncHealthSnapshot>(
    () => ({
      v: 1,
      atMs: Date.now(),
      referencePeer: null,
      peers: [],
      mismatches: [],
      conflictCounts: { open: 0, acked: 0, resolved: 0, ignored: 0, criticalOpen: 0 },
      determinism: undefined,
      gates: undefined,
      severity: "ok",
      headline: undefined,
    }),
    []
  );

  // ---- NL command handlers ----
  const commandCtx = useMemo<CommandContext>(
    () => ({ v: 1, role: "host", isCollaborative: true, referencePeer: null, focusedPanel: undefined, selectedEntityId: null }),
    []
  );

  const commandHandlers = useMemo<CommandHandlers>(
    () => ({
      openPanel: async (panel: string) => {
        await audit.log("nl.cmd.open_panel", true, { panel });
        panels.open(panel);
        return { ok: true, message: `opened ${panel}` };
      },
      setReferencePeer: async (peer: string | null) => {
        await audit.log("nl.cmd.set_reference_peer", true, { peer });
        return { ok: true, message: peer ? `reference peer set to ${peer}` : "reference peer cleared" };
      },
      requestSnapshot: async (peer: string) => {
        await audit.log("nl.cmd.request_snapshot", true, { peer });
        return { ok: true, message: `requested snapshot from ${peer}` };
      },
      forcePublish: async () => {
        await audit.log("nl.cmd.force_publish", true, {});
        return { ok: true, message: "force publish requested" };
      },
      ackConflict: async (id: string) => {
        await audit.log("nl.cmd.ack_conflict", true, { id });
        return { ok: true, message: `acked ${id}` };
      },
      autoAckConflicts: async () => {
        await audit.log("nl.cmd.auto_ack_conflicts", true, {});
        return { ok: true, message: "auto-ack triggered" };
      },
      setRobustnessGate: async (name: string, value: number) => {
        await audit.log("nl.cmd.set_gate", true, { name, value });
        return { ok: true, message: `set ${name}=${value}` };
      },
      startOptimization: async () => {
        await audit.log("nl.cmd.start_opt", true, {});
        return { ok: true, message: "optimization started" };
      },
      stopOptimization: async () => {
        await audit.log("nl.cmd.stop_opt", true, {});
        return { ok: true, message: "optimization stopped" };
      },
      help: async () => ({ ok: true, message: "Type commands like 'open sync', 'force publish', 'help'." }),
    }),
    [audit, panels]
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <ApprovalUI />

      <NLCommandBar ctx={commandCtx} handlers={commandHandlers} audit={{ log: (...args: any[]) => (audit as any).log?.(...args) }} />

      <SyncHealthPanel snap={syncSnap} />
    </div>
  );
}
