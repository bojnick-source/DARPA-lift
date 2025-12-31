// ==========================================
// REAL-TIME CONFLICT HANDLING — A16 (HARDENED)
// Adds explicit patch kinds and conflict policy.
// Only "pathset" ops are conflict-resolvable (LWW per-path).
// ==========================================

export type DocId = string;
export type ClientId = string;

export type PatchKind = "pathset" | "merge" | "set";

export type ConflictPolicy =
  | "strict"          // reject if baseVersion != current
  | "lww_pathset";    // allow stale baseVersion for pathset ops (last-write-wins per path)

export interface PathSetOp {
  path: string;       // "a.b.c"
  value: any;
  // optional metadata for conflict audit
  ts?: number;        // client timestamp (ms since epoch)
  clientId?: ClientId;
}

export type Patch =
  | { kind: "set"; value: any }
  | { kind: "merge"; value: Record<string, any> }
  | { kind: "pathset"; ops: PathSetOp[]; policy?: ConflictPolicy };

export type CollabMsgV2 =
  | { t: "hello"; clientId: ClientId; docId: DocId; lastSeenVersion: number }
  | { t: "snapshot"; docId: DocId; version: number; state: unknown }
  | { t: "op"; docId: DocId; baseVersion: number; opId: string; patch: Patch }
  | { t: "ack"; docId: DocId; opId: string; newVersion: number }
  | { t: "presence"; docId: DocId; clientId: ClientId; cursor?: any; selection?: any }
  | { t: "conflict"; docId: DocId; opId: string; applied: boolean; reason: string; serverVersion: number }
  | { t: "error"; code: string; message: string };
