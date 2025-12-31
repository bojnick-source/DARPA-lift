// ==========================================
// AUTOMERGE ADAPTER SHELL — A175 (HARDENED)
// FILE: uiux/advanced/crdt/automerge_adapter.ts
// This is a shell: it compiles without Automerge installed.
// Wire it by providing a concrete AutomergeOps implementation.
// ==========================================

import type { CRDTProvider, CRDTApplyResult, CRDTExportBundle, CRDTOpEnvelope, CRDTSnapshotEnvelope } from "./crdt_types";
import type { MigrationRegistry } from "./migrations";
import { makeMeta, makeOpEnvelope, makeSnapshot } from "./provider_base";

export interface AutomergeOps<State> {
  // create a new doc from state
  fromState: (state: State) => any;

  // materialize app state from doc
  toState: (doc: any) => State;

  // perform deterministic change
  change: (doc: any, fn: (draft: any) => void) => { doc: any; patch: any; clock?: string };

  // apply remote patch/op
  apply: (doc: any, patch: any) => { doc: any; clock?: string; changed: boolean };

  // snapshot encode/decode
  encodeSnapshot: (doc: any) => any;
  decodeSnapshot: (snap: any) => any;

  // optional op log (if available)
  encodeOp?: (patch: any) => any;
  decodeOp?: (payload: any) => any;
}

export class AutomergeProvider<State> implements CRDTProvider<State> {
  kind: "automerge" = "automerge";

  private doc: any;
  private schemaVersion: string;
  private clientTag: string;

  constructor(opts: {
    initialState: State;
    schemaVersion: string;
    clientTag: string;
    migrations: MigrationRegistry<State>;
    automerge: AutomergeOps<State>;
    targetSchemaVersion?: string;
  }) {
    const target = opts.targetSchemaVersion ?? opts.schemaVersion;
    const upgraded = opts.migrations.upgrade(opts.initialState, opts.schemaVersion, target);
    this.schemaVersion = target;
    this.clientTag = opts.clientTag;
    this.doc = opts.automerge.fromState(upgraded.state);
    this.ops = opts.automerge;
    this.migrations = opts.migrations;
  }

  private ops: AutomergeOps<State>;
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
      // apply on doc draft
      const r = this.ops.change(this.doc, (draftDoc) => {
        const stateDraft = this.ops.toState(draftDoc);
        changeFn(stateDraft);
        // overwrite doc with modified state (deterministic bridge)
        // NOTE: in real Automerge you’d mutate draftDoc directly; this bridge keeps app state canonical.
        const newDoc = this.ops.fromState(stateDraft);
        Object.assign(draftDoc, newDoc);
      });

      this.doc = r.doc;

      const meta = await this.getMeta();
      const op = await makeOpEnvelope({
        provider: "automerge",
        payload: this.ops.encodeOp ? this.ops.encodeOp(r.patch) : r.patch,
        clock: r.clock,
        from: this.clientTag,
      });

      return { result: { ok: true, meta, changed: true }, op };
    } catch (e: any) {
      return { result: { ok: false, error: String(e?.message ?? e) } };
    }
  }

  async applyOp(op: CRDTOpEnvelope): Promise<CRDTApplyResult> {
    try {
      if (op.provider !== "automerge") return { ok: false, error: "provider mismatch" };
      const patch = this.ops.decodeOp ? this.ops.decodeOp(op.payload) : op.payload;
      const r = this.ops.apply(this.doc, patch);
      this.doc = r.doc;
      const meta = await this.getMeta();
      return { ok: true, meta, changed: r.changed };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }

  async applySnapshot(snap: CRDTSnapshotEnvelope): Promise<CRDTApplyResult> {
    try {
      if (snap.provider !== "automerge") return { ok: false, error: "provider mismatch" };
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
      provider: "automerge",
      schemaVersion: this.schemaVersion,
      state,
      snapshot: this.ops.encodeSnapshot(this.doc),
    });

    // No op-log by default in this shell
    const bundleHash = (await this.getMeta()).stateHash;

    return {
      v: 1,
      provider: "automerge",
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
