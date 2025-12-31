// ==========================================
// SYNC HEALTH PANEL — A43 (HARDENED)
// Normalizes inputs from CRDT provider + presence + audit logger into panel props.
// ==========================================

import type { ConnStatus, SyncHealthInputs } from "./SyncHealthPanel";

export interface HealthModelSources {
  connStatus: ConnStatus;
  room: string;
  docId?: string;
  peersCount: number;
  auditHashChainEnabled: boolean;
  lastAuditHash?: string;
  uiStateSnapshot: any;
  lastDivergence?: SyncHealthInputs["lastDivergence"];
}

export function buildSyncHealthInputs(src: HealthModelSources): SyncHealthInputs {
  return {
    connStatus: src.connStatus,
    room: src.room,
    docId: src.docId,
    peersCount: Math.max(0, src.peersCount | 0),
    auditHashChainEnabled: !!src.auditHashChainEnabled,
    lastAuditHash: src.lastAuditHash,
    uiStateSnapshot: src.uiStateSnapshot ?? {},
    lastDivergence: src.lastDivergence,
  };
}
