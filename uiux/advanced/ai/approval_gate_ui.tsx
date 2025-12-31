// ==========================================
// APPROVAL GATE IMPLEMENTATION — A58 (HARDENED)
// Implements ApprovalGate using ApprovalModal.
// ==========================================

import React, { useCallback, useState } from "react";
import type { ApprovalGate, ApprovalRequest } from "./approval_gate";
import { ApprovalModal } from "./ApprovalModal";

export function createModalApprovalGate(opts?: { costlyPipelines?: string[] }): {
  gate: ApprovalGate;
  UI: React.FC;
} {
  const state = {
    resolver: null as null | ((v: boolean) => void),
    req: null as null | ApprovalRequest,
  };

  const gate: ApprovalGate = {
    async requestApproval(req: ApprovalRequest): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        state.req = req;
        state.resolver = resolve;
        // UI component will render once mounted
        forceRerender?.();
      });
    },
  };

  // Small internal rerender hook
  let forceRerender: null | (() => void) = null;

  const UI: React.FC = () => {
    const [, setTick] = useState(0);
    forceRerender = () => setTick((t) => t + 1);

    const open = !!state.req;

    const approve = useCallback(() => {
      const r = state.resolver;
      state.req = null;
      state.resolver = null;
      r?.(true);
      forceRerender?.();
    }, []);

    const deny = useCallback(() => {
      const r = state.resolver;
      state.req = null;
      state.resolver = null;
      r?.(false);
      forceRerender?.();
    }, []);

    return (
      <ApprovalModal
        open={open}
        title={state.req?.title ?? ""}
        summary={state.req?.summary ?? ""}
        actions={state.req?.actions ?? []}
        onApprove={approve}
        onDeny={deny}
        costlyPipelines={opts?.costlyPipelines}
      />
    );
  };

  return { gate, UI };
}
