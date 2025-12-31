// ==========================================
// NL + CRDT WIRING — A30 (HARDENED)
// Makes NL "set_value" write into Yjs (CRDT) instead of local-only state.
// Also mirrors CRDT changes back into UIStateAPI via YjsCollabClient.bindToUI().
// ==========================================

import type { CommandExec } from "./command_router";
import type { NLSecurityPolicy } from "./bindings";
import { DEFAULT_NL_POLICY } from "./bindings";
import { haptic } from "../haptics";
import type { YjsCollabClient } from "../collab/crdt/client_yjs";

export interface UIStateAPI {
  setValue(path: string, value: any): void;
}

export interface UIPanelsAPI {
  open(panel: string): void;
}

export interface UIPipelinesAPI {
  run(pipeline: string): Promise<void>;
}

function isAllowedPath(path: string, policy: NLSecurityPolicy): boolean {
  return policy.allowedPaths.some((prefix) => path.startsWith(prefix));
}

export interface NLCrdtBridgeOptions {
  crdt: YjsCollabClient;
  uiState: UIStateAPI;          // UI store (for rendering)
  panels: UIPanelsAPI;
  pipelines: UIPipelinesAPI;
  policy?: NLSecurityPolicy;
  audit?: (e: { ok: boolean; reason?: string; action?: any }) => void;
  maxValueBytes?: number;       // defense (default 256k)
}

/**
 * Bridge: CRDT is source-of-truth. UI state is a projection of CRDT.
 *
 * - On startup, bind CRDT -> UI updates.
 * - On NL actions, write to CRDT (broadcasts to others automatically).
 */
export function createNLCrdtCommandExec(opts: NLCrdtBridgeOptions): CommandExec {
  const policy = opts.policy ?? DEFAULT_NL_POLICY;
  const maxBytes = opts.maxValueBytes ?? 256_000;

  // Bind CRDT updates into UI (projection)
  opts.crdt.bindToUI(opts.uiState, policy.allowedPaths);

  const exec: CommandExec = {
    setValue(path: string, value: any): void {
      if (typeof path !== "string" || path.length === 0) {
        opts.audit?.({ ok: false, reason: "EMPTY_PATH", action: { type: "set_value", path } });
        haptic("error");
        return;
      }
      if (!isAllowedPath(path, policy)) {
        opts.audit?.({ ok: false, reason: `PATH_NOT_ALLOWED:${path}`, action: { type: "set_value", path } });
        haptic("error");
        return;
      }

      // size defense
      let approx = 0;
      try {
        approx = JSON.stringify(value).length;
      } catch {
        approx = 0;
      }
      if (approx > maxBytes) {
        opts.audit?.({ ok: false, reason: "VALUE_TOO_LARGE", action: { type: "set_value", path, bytes: approx } });
        haptic("error");
        return;
      }

      try {
        opts.crdt.setValue(path, value, maxBytes);
        opts.audit?.({ ok: true, action: { type: "set_value", path } });
        haptic("tap");
      } catch (e: any) {
        opts.audit?.({ ok: false, reason: `CRDT_SET_FAILED:${String(e?.message ?? e)}`, action: { type: "set_value", path } });
        haptic("error");
      }
    },

    openPanel(panel: string): void {
      if (!policy.allowedPanels.includes(panel as any)) {
        opts.audit?.({ ok: false, reason: `PANEL_NOT_ALLOWED:${panel}`, action: { type: "open_panel", panel } });
        haptic("error");
        return;
      }
      opts.panels.open(panel);
      opts.audit?.({ ok: true, action: { type: "open_panel", panel } });
      haptic("tap");
    },

    runPipeline(pipeline: string): void {
      if (!policy.allowedPipelines.includes(pipeline as any)) {
        opts.audit?.({ ok: false, reason: `PIPELINE_NOT_ALLOWED:${pipeline}`, action: { type: "run_pipeline", pipeline } });
        haptic("error");
        return;
      }

      opts.pipelines
        .run(pipeline)
        .then(() => {
          opts.audit?.({ ok: true, action: { type: "run_pipeline", pipeline } });
          haptic("confirm");
        })
        .catch((e) => {
          opts.audit?.({ ok: false, reason: `PIPELINE_FAILED:${String(e?.message ?? e)}`, action: { type: "run_pipeline", pipeline } });
          haptic("error");
        });
    },
  };

  return exec;
}
