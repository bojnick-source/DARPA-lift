// ==========================================
// UPGRADE PROTOCOL (RT MSGS) — A217 (HARDENED)
// FILE: uiux/advanced/crdt_upgrade/upgrade_protocol.ts
// Extends RT messages without mutating core RT types.
// ==========================================

export type UpgradeMsgKind =
  | "upgrade_propose"
  | "upgrade_vote"
  | "upgrade_apply"
  | "upgrade_status";

export interface UpgradeMsgBase {
  v: 1;
  kind: UpgradeMsgKind;

  id: string;
  from: string;
  to?: string | null;
  atMs: number;
}

export interface UpgradeProposeMsg extends UpgradeMsgBase {
  kind: "upgrade_propose";
  proposal: import("./upgrade_types").UpgradeProposal;
}

export interface UpgradeVoteMsg extends UpgradeMsgBase {
  kind: "upgrade_vote";
  vote: import("./upgrade_types").UpgradeVote;
}

export interface UpgradeApplyMsg extends UpgradeMsgBase {
  kind: "upgrade_apply";
  proposalId: string;
  planId: string;
}

export interface UpgradeStatusMsg extends UpgradeMsgBase {
  kind: "upgrade_status";
  status: import("./upgrade_types").UpgradeStatus;
}

export type UpgradeMsg = UpgradeProposeMsg | UpgradeVoteMsg | UpgradeApplyMsg | UpgradeStatusMsg;
