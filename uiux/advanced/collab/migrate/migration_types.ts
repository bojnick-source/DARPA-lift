// ==========================================
// CRDT UPGRADE / MIGRATION TYPES — A85 (HARDENED)
// ==========================================

export interface MigrationContext {
  room: string;
  docId: string;
  clientTag: string;
  fromVersion: number;
  toVersion: number;
  nowMs: number;
}

export interface MigrationResult {
  ok: boolean;
  fromVersion: number;
  toVersion: number;
  changed: boolean;
  note?: string;
}

export type MigrationFn = (state: any, ctx: MigrationContext) => MigrationResult;

export interface MigrationPlan {
  latestVersion: number;
  migrations: Record<number, MigrationFn>; // key=fromVersion -> migrator to fromVersion+1
}
