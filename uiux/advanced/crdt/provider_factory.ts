// ==========================================
// PROVIDER FACTORY + MEMORY FALLBACK — A177 (HARDENED)
// FILE: uiux/advanced/crdt/provider_factory.ts
// Includes a deterministic in-memory provider for offline/single-user mode.
// ==========================================

import type { CRDTProvider, CRDTApplyResult, CRDTOpEnvelope, CRDTSnapshotEnvelope, CRDTExportBundle } from "./crdt_types";
import type { MigrationRegistry } from "./migrations";
import { makeMeta, makeOpEnvelope, makeSnapshot } from "./provider_base";
import type { AutomergeOps } from "./automerge_adapter";
import type { YjsOps } from "./yjs_adapter";
import { AutomergeProvider } from "./automerge_adapter";
import { YjsProvider } from "./yjs_adapter";

export class MemoryProvider<State> implements CRDTProvider<State> {
  kind: "memory" = "memory";
  private state: State;
  private schemaVersion: string;
  private clientTag: string;

  constructor(opts: {
    initialState: State;
    schemaVersion: string;
    clientTag: string;
    migrations: MigrationRegistry<State>;
    targetSchemaVersion?: string;
  }) {
    const target = opts.targetSchemaVersion ?? opts.schemaVersion;
    const upgraded = opts.migrations.upgrade(opts.initialState, opts.schemaVersion, target);
    this.state = upgraded.state;
    this.schemaVersion = target;
    this.clientTag = opts.clientTag;
  }

  getClientTag(): string {
    return this.clientTag;
  }

  getState(): State {
    return this.state;
  }

  async getMeta() {
    return makeMeta({
      schemaVersion: this.schemaVersion,
      state: this.state,
      clientTag: this.clientTag,
    });
  }

  async change(changeFn: (draft: State) => void): Promise<{ result: CRDTApplyResult; op?: CRDTOpEnvelope }> {
    try {
      const next = structuredClone(this.state);
      changeFn(next);
      this.state = next;

      const meta = await this.getMeta();
      const op = await makeOpEnvelope({
        provider: "memory",
        payload: { type: "set_state", schemaVersion: this.schemaVersion, state: this.state },
        from: this.clientTag,
      });

      return { result: { ok: true, meta, changed: true }, op };
    } catch (e: any) {
      return { result: { ok: false, error: String(e?.message ?? e) } };
    }
  }

  async applyOp(op: CRDTOpEnvelope): Promise<CRDTApplyResult> {
    if (op.provider !== "memory") return { ok: false, error: "provider mismatch" };
    if (op.payload?.type !== "set_state") return { ok: false, error: "unsupported op" };
    this.schemaVersion = String(op.payload.schemaVersion);
    this.state = op.payload.state;
    const meta = await this.getMeta();
    return { ok: true, meta, changed: true };
  }

  async applySnapshot(snap: CRDTSnapshotEnvelope): Promise<CRDTApplyResult> {
    if (snap.provider !== "memory") return { ok: false, error: "provider mismatch" };
    this.schemaVersion = snap.schemaVersion;
    this.state = snap.snapshot?.state;
    const meta = await this.getMeta();
    return { ok: true, meta, changed: true };
  }

  async exportBundle(): Promise<CRDTExportBundle> {
    const snapshot = await makeSnapshot({
      provider: "memory",
      schemaVersion: this.schemaVersion,
      state: this.state,
      snapshot: { state: this.state },
    });
    const bundleHash = (await this.getMeta()).stateHash;
    return { v: 1, provider: "memory", schemaVersion: this.schemaVersion, bundleHash, snapshot };
  }

  async reset(state: State, schemaVersion: string): Promise<CRDTApplyResult> {
    this.schemaVersion = schemaVersion;
    this.state = state;
    const meta = await this.getMeta();
    return { ok: true, meta, changed: true };
  }
}

export function createCRDTProvider<State>(opts: {
  kind: "automerge" | "yjs" | "memory";
  initialState: State;
  schemaVersion: string;
  targetSchemaVersion?: string;
  clientTag: string;
  migrations: MigrationRegistry<State>;

  // optional adapters
  automergeOps?: AutomergeOps<State>;
  yjsOps?: YjsOps<State>;
}): CRDTProvider<State> {
  if (opts.kind === "automerge") {
    if (!opts.automergeOps) throw new Error("automergeOps required for automerge provider");
    return new AutomergeProvider<State>({
      initialState: opts.initialState,
      schemaVersion: opts.schemaVersion,
      targetSchemaVersion: opts.targetSchemaVersion,
      clientTag: opts.clientTag,
      migrations: opts.migrations,
      automerge: opts.automergeOps,
    });
  }

  if (opts.kind === "yjs") {
    if (!opts.yjsOps) throw new Error("yjsOps required for yjs provider");
    return new YjsProvider<State>({
      initialState: opts.initialState,
      schemaVersion: opts.schemaVersion,
      targetSchemaVersion: opts.targetSchemaVersion,
      clientTag: opts.clientTag,
      migrations: opts.migrations,
      yjs: opts.yjsOps,
    });
  }

  return new MemoryProvider<State>({
    initialState: opts.initialState,
    schemaVersion: opts.schemaVersion,
    targetSchemaVersion: opts.targetSchemaVersion,
    clientTag: opts.clientTag,
    migrations: opts.migrations,
  });
}
