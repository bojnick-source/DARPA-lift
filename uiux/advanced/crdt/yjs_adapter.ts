// ==========================================
// YJS ADAPTER SHELL — A176 (HARDENED)
// FILE: uiux/advanced/crdt/yjs_adapter.ts
// Shell: compiles without Yjs installed.
// Wire by providing YjsOps implementation.
// ==========================================

import type { CRDTProvider, CRDTApplyResult, CRDTExportBundle, CRDTOpEnvelope, CRDTSnapshotEnvelope } from "./crdt_types";
import type { MigrationRegistry } from "./migrations";
import { makeMeta, makeOpEnvelope, makeSnapshot } from "./provider_base";

export interface YjsOps<State> {
  // Create internal doc from state
  fromState: (state: State) => any;

  // Materialize state from doc
  toState: (doc: any) => State;

  // Apply local change and return update bytes/object
  change: (doc: any, fn: (draftState: State) => void) => { doc: any; update: any; clock?: string; changed: boolean };

  // Apply remote update
  applyUpdate: (doc: any, update: any) => { doc: any; clock?: string; changed: boolean };

  // Snapshot encode/decode
  encodeSnapshot: (doc: any) => any;
  decodeSnapshot: (snap: any) => any;
}

export class YjsProvider<State> implements CRDTProvider<State> {
  kind: "yjs" = "yjs";

  private doc: any;
  private schemaVersion: string;
  private clientTag: string;

  constructor(opts: {
    initialState: State;
    schemaVersion: string;
    clientTag: string;
    migrations: MigrationRegistry<State>;
    yjs: YjsOps<State>;
    targetSchemaVersion?: string;
  }) {
    const target = opts.targetSchemaVersion ?? opts.schemaVersion;
    const upgraded = opts.migrations.upgrade(opts.initialState, opts.schemaVersion, target);
    this.schemaVersion = target;
    this.clientTag = opts.clientTag;
    this.ops = opts.yjs;
    this.migrations = opts.migrations;
    this.doc = this.ops.fromState(upgraded.state);
  }

  private ops: YjsOps<State>;
  private migrations: MigrationRegistry<State>;

  getClientTag(): string {
    return this.clientTag;
  }

  getState(): State {
    return this.ops.toState(this.doc);
  }

  async getMeta() {
    return makeMeta({
      schemaVersion: this.schemaVersion,
      state: this.getState(),
      clientTag: this.clientTag,
    });
  }

  async change(changeFn: (draft: State) => void, note?: string): Promise<{ result: CRDTApplyResult; op?: CRDTOpEnvelope }> {
    try {
      const r = this.ops.change(this.doc, (draftState) => changeFn(draftState));
      this.doc = r.doc;

      const meta = await this.getMeta();
      const op = await makeOpEnvelope({
        provider: "yjs",
        payload: r.update,
        clock: r.clock,
        from: this.clientTag,
      });

      return { result: { ok: true, meta, changed: r.changed }, op };
    } catch (e: any) {
      return { result: { ok: false, error: String(e?.message ?? e) } };
    }
  }

  async applyOp(op: CRDTOpEnvelope): Promise<CRDTApplyResult> {
    try {
      if (op.provider !== "yjs") return { ok: false, error: "provider mismatch" };
      const r = this.ops.applyUpdate(this.doc, op.payload);
      this.doc = r.doc;
      const meta = await this.getMeta();
      return { ok: true, meta, changed: r.changed };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }

  async applySnapshot(snap: CRDTSnapshotEnvelope): Promise<CRDTApplyResult> {
    try {
      if (snap.provider !== "yjs") return { ok: false, error: "provider mismatch" };
      this.schemaVersion = snap.schemaVersion;
      this.doc = this.ops.decodeSnapshot(snap.snapshot);
      const meta = await this.getMeta();
      return { ok: true, meta, changed: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }

  async exportBundle(opts?: { includeOps?: boolean; maxOps?: number }): Promise<CRDTExportBundle> {
    const state = this.getState();
    const snapshot = await makeSnapshot({
      provider: "yjs",
      schemaVersion: this.schemaVersion,
      state,
      snapshot: this.ops.encodeSnapshot(this.doc),
    });

    const bundleHash = (await this.getMeta()).stateHash;

    return {
      v: 1,
      provider: "yjs",
      schemaVersion: this.schemaVersion,
      bundleHash,
      snapshot,
      ops: opts?.includeOps ? [] : undefined,
    };
  }

  async reset(state: State, schemaVersion: string): Promise<CRDTApplyResult> {
    try {
      this.schemaVersion = schemaVersion;
      this.doc = this.ops.fromState(state);
      const meta = await this.getMeta();
      return { ok: true, meta, changed: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }
}
