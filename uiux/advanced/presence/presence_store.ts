// ==========================================
// PRESENCE STORE — A186 (HARDENED)
// FILE: uiux/advanced/presence/presence_store.ts
// Maintains presence + RTT estimates. CRDT-agnostic.
// ==========================================

import type { PresencePeer, PresenceSnapshot, PresenceStatus } from "./presence_types";

function sortPeers(peers: PresencePeer[]): PresencePeer[] {
  return [...peers].sort((a, b) => a.clientTag.localeCompare(b.clientTag));
}

export class PresenceStore {
  private local: PresencePeer;
  private peers = new Map<string, PresencePeer>();

  constructor(localClientTag: string) {
    this.local = { clientTag: localClientTag, status: "online", atMs: Date.now() };
  }

  setLocalStatus(status: PresenceStatus) {
    this.local = { ...this.local, status, atMs: Date.now() };
  }

  upsertPeer(p: PresencePeer) {
    this.peers.set(p.clientTag, p);
  }

  setPeerStatus(clientTag: string, status: PresenceStatus, atMs: number) {
    const prev = this.peers.get(clientTag);
    this.peers.set(clientTag, {
      clientTag,
      status,
      atMs,
      stateHash: prev?.stateHash,
      schemaVersion: prev?.schemaVersion,
      rttMs: prev?.rttMs,
    });
  }

  setPeerMeta(clientTag: string, meta: { stateHash: string; schemaVersion: string; atMs: number }) {
    const prev = this.peers.get(clientTag);
    this.peers.set(clientTag, {
      clientTag,
      status: prev?.status ?? "online",
      atMs: meta.atMs,
      stateHash: meta.stateHash,
      schemaVersion: meta.schemaVersion,
      rttMs: prev?.rttMs,
    });
  }

  setPeerRTT(clientTag: string, rttMs: number) {
    const prev = this.peers.get(clientTag);
    if (!prev) return;
    const smoothed = prev.rttMs == null ? rttMs : Math.round(0.7 * prev.rttMs + 0.3 * rttMs);
    this.peers.set(clientTag, { ...prev, rttMs: smoothed });
  }

  snapshot(): PresenceSnapshot {
    const peers = sortPeers([...this.peers.values()]);

    const onlineCount = peers.filter((p) => p.status === "online").length;
    const awayCount = peers.filter((p) => p.status === "away").length;
    const offlineCount = peers.filter((p) => p.status === "offline").length;

    return { v: 1, local: this.local, peers, onlineCount, awayCount, offlineCount };
  }
}
