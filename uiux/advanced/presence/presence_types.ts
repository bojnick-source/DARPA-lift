// ==========================================
// PRESENCE TYPES — A185 (HARDENED)
// FILE: uiux/advanced/presence/presence_types.ts
// ==========================================

export type PresenceStatus = "online" | "away" | "offline";

export interface PresencePeer {
  clientTag: string;
  status: PresenceStatus;

  // last known publish/meta timestamp
  atMs: number;

  // optional: latest state hash for quick UI
  stateHash?: string;
  schemaVersion?: string;

  // optional latency sampling (ms)
  rttMs?: number;
}

export interface PresenceSnapshot {
  v: 1;
  local: PresencePeer;
  peers: PresencePeer[];

  // derived
  onlineCount: number;
  awayCount: number;
  offlineCount: number;
}
