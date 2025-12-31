// ==========================================
// COLLAB KERNEL — A223 (HARDENED)
// FILE: uiux/advanced/collab/collab_kernel.ts
// Single pipe: receive -> classify -> apply -> audit -> conflicts -> sync health.
// ==========================================

import type {
  CollabKernelConfig,
  CollabKernelDeps,
  KernelState,
  RTTransport,
  CRDTProvider,
} from "./collab_types";

import { bindConflicts } from "../conflicts/conflict_glue";

import type { UpgradeMsg } from "../crdt_upgrade/upgrade_protocol";

function nowMs() {
  return Date.now();
}

function isUpgradeMsg(x: any): x is UpgradeMsg {
  return !!x && x.v === 1 && typeof x.kind === "string" && String(x.kind).startsWith("upgrade_");
}

// Minimal RT core message kinds the kernel understands.
// If your RT protocol already defines these, this still works.
type CoreRTKind = "op" | "snapshot" | "hash_publish" | "mismatch" | "hello" | "presence" | "nl";
function isCoreRTMsg(x: any): x is { kind: CoreRTKind; from: string; id?: string } {
  return !!x && typeof x.kind === "string" && typeof x.from === "string";
}

// small helper for consistent peer meta extraction
function extractPeerMeta(msg: any): { schemaVersion?: string; stateHash?: string } {
  const meta = msg?.meta ?? msg?.payload?.meta ?? null;
  if (!meta) return {};
  return {
    schemaVersion: meta.schemaVersion,
    stateHash: meta.stateHash,
  };
}

export class CollabKernel<State = any> {
  private cfg: CollabKernelConfig;
  private deps: CollabKernelDeps<State>;

  private state: KernelState = "idle";

  private offMsg?: () => void;
  private offOpen?: () => void;
  private offClose?: () => void;
  private offErr?: () => void;

  private stopTimer?: () => void;

  // conflict glue (optional)
  private conflictGlue?: ReturnType<typeof bindConflicts<State>>;

  constructor(cfg: CollabKernelConfig, deps: CollabKernelDeps<State>) {
    this.cfg = {
      publishHashEveryMs: 1500,
      strictSchemaMatch: false,
      referencePeer: deps?.syncHealth ? cfg.referencePeer ?? null : cfg.referencePeer ?? null,
      ...cfg,
    };
    this.deps = deps;
  }

  getState(): KernelState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== "idle") return;

    this.state = "running";

    // SyncHealth bootstrap
    this.deps.syncHealth?.setReferencePeer(this.cfg.referencePeer ?? null);

    // Install conflict glue if conflicts exist
    if (this.deps.conflicts && this.deps.crdt) {
      this.conflictGlue = bindConflicts<State>({
        conflicts: this.deps.conflicts,
        audit: this.deps.audit,
        crdt: this.deps.crdt as any,
        onUpdated: () => {
          const counts = this.deps.conflicts!.counts();
          this.deps.syncHealth?.setConflictCounts(counts);
        },
      });

      // initial counts
      this.deps.syncHealth?.setConflictCounts(this.deps.conflicts.counts());
    }

    // load robustness gates policy if provided
    if (this.deps.robustnessPolicy && this.deps.syncHealth) {
      try {
        const gates = await this.deps.robustnessPolicy.getGates();
        this.deps.syncHealth.setGates(gates as any);
        await this.deps.audit?.log("policy", "robustness_gates.loaded", true, { count: gates.length });
      } catch (e: any) {
        await this.deps.audit?.log("policy", "robustness_gates.loaded", false, { error: String(e?.message ?? e) });
      }
    }

    // Transport hooks
    this.offMsg = this.deps.transport.onMessage((msg) => {
      void this.onInbound(msg);
    });

    this.offOpen = this.deps.transport.onOpen?.(() => {
      void this.onOpen();
    });

    this.offClose = this.deps.transport.onClose?.((reason) => {
      void this.onClose(reason);
    });

    this.offErr = this.deps.transport.onError?.((err) => {
      void this.onError(err);
    });

    await this.deps.transport.connect?.();

    // Publish our meta periodically (schemaVersion + stateHash)
    this.stopTimer = this.startPeriodicPublisher(this.deps.transport, this.deps.crdt);

    await this.deps.audit?.log("system", "kernel.start", true, { clientTag: this.cfg.clientTag });
  }

  async shutdown(): Promise<void> {
    if (this.state === "closed") return;

    this.state = "closed";

    this.stopTimer?.();
    this.stopTimer = undefined;

    this.offMsg?.(); this.offMsg = undefined;
    this.offOpen?.(); this.offOpen = undefined;
    this.offClose?.(); this.offClose = undefined;
    this.offErr?.(); this.offErr = undefined;

    await this.deps.transport.close?.();

    await this.deps.audit?.log("system", "kernel.shutdown", true, {});
    await this.deps.audit?.flush?.();
  }

  // -----------------------------
  // Inbound pipe (single entry)
  // -----------------------------
  private async onInbound(msg: any): Promise<void> {
    // 1) Upgrade messages (CRDT schema upgrades)
    if (isUpgradeMsg(msg) && this.deps.upgrade) {
      await this.deps.audit?.log("crdt", "upgrade.rx", true, { kind: msg.kind, from: msg.from, id: msg.id });
      await this.deps.upgrade.onUpgradeMsg(msg);
      return;
    }

    // 2) Core RT messages
    if (!isCoreRTMsg(msg)) {
      await this.deps.audit?.log("rt", "rt.rx.unknown", false, { msg });
      return;
    }

    // Let conflict glue observe RT messages (mismatch, schema mismatch hints, etc.)
    await this.conflictGlue?.onRTMsg(msg as any);

    // Route
    switch (msg.kind) {
      case "hello":
      case "presence":
      case "hash_publish":
        await this.onPeerMeta(msg);
        break;

      case "mismatch":
        await this.onMismatch(msg);
        break;

      case "op":
        await this.onRemoteOp(msg);
        break;

      case "snapshot":
        await this.onRemoteSnapshot(msg);
        break;

      case "nl":
        await this.onNL(msg);
        break;

      default:
        await this.deps.audit?.log("rt", "rt.rx.unhandled", false, { kind: msg.kind, from: msg.from });
        break;
    }
  }

  // -----------------------------
  // Transport lifecycle
  // -----------------------------
  private async onOpen(): Promise<void> {
    await this.deps.audit?.log("rt", "transport.open", true, {});
    await this.publishHello();
    await this.runDeterminismCheckIfAny();
  }

  private async onClose(reason?: any): Promise<void> {
    await this.deps.audit?.log("rt", "transport.close", true, { reason });
  }

  private async onError(err: any): Promise<void> {
    await this.deps.audit?.log("rt", "transport.error", false, { err: String(err?.message ?? err) });
    await this.conflictGlue?.onTransportError({ error: String(err?.message ?? err), where: "transport" });
  }

  // -----------------------------
  // Peer meta + SyncHealth peer list
  // -----------------------------
  private async onPeerMeta(msg: any): Promise<void> {
    const { schemaVersion, stateHash } = extractPeerMeta(msg);

    // Optionally treat schema mismatch as conflict
    if (schemaVersion) {
      const local = await this.deps.crdt.getMeta();
      if (local.schemaVersion !== schemaVersion) {
        // conflictGlue already adds schema mismatch on "hello/presence/hash_publish"
        if (this.cfg.strictSchemaMatch && this.deps.conflicts) {
          await this.deps.conflicts.add({
            severity: "critical",
            kind: "schema_mismatch",
            title: "Schema version mismatch (strict)",
            detail: `Local=${local.schemaVersion}, Peer(${msg.from})=${schemaVersion}`,
            sourcePeer: msg.from,
            payload: { local: local.schemaVersion, peer: schemaVersion },
            recommendedAction: "request_snapshot",
          });
          this.deps.syncHealth?.setConflictCounts(this.deps.conflicts.counts());
        }
      }
    }

    // Update peers in SyncHealth from presence provider if available; else infer from messages.
    if (this.deps.syncHealth) {
      const peersFromPresence = this.deps.presence?.listPeers?.() ?? [];
      const merged = new Map<string, { clientTag: string; schemaVersion?: string; stateHash?: string; publishedMs?: number }>();

      for (const p of peersFromPresence) {
        const meta = p.meta ?? {};
        merged.set(p.clientTag, {
          clientTag: p.clientTag,
          schemaVersion: meta.schemaVersion,
          stateHash: meta.stateHash,
          publishedMs: meta.atMs ?? nowMs(),
        });
      }

      // ensure current message peer is included
      if (!merged.has(msg.from)) {
        merged.set(msg.from, {
          clientTag: msg.from,
          schemaVersion,
          stateHash,
          publishedMs: msg.atMs ?? nowMs(),
        });
      } else {
        // patch known
        const cur = merged.get(msg.from)!;
        merged.set(msg.from, {
          ...cur,
          schemaVersion: schemaVersion ?? cur.schemaVersion,
          stateHash: stateHash ?? cur.stateHash,
          publishedMs: msg.atMs ?? cur.publishedMs ?? nowMs(),
        });
      }

      this.deps.syncHealth.setPeers(
        [...merged.values()].map((p) => ({
          clientTag: p.clientTag,
          hash: p.stateHash ?? "",
          schemaVersion: p.schemaVersion ?? "",
          publishedMs: p.publishedMs ?? nowMs(),
        }))
      );
    }

    await this.deps.audit?.log("rt", "peer.meta", true, { from: msg.from, schemaVersion, stateHash });
  }

  // -----------------------------
  // Mismatch handling
  // -----------------------------
  private async onMismatch(msg: any): Promise<void> {
    const referencePeer = msg.referencePeer ?? this.cfg.referencePeer ?? null;

    // Push mismatch event to SyncHealth
    this.deps.syncHealth?.addMismatch({
      id: msg.id ?? `mm_${nowMs()}`,
      atMs: msg.atMs ?? nowMs(),
      localHash: msg.localHash,
      remoteHash: msg.remoteHash,
      referencePeer,
      note: msg.note,
    });

    await this.deps.audit?.log("rt", "mismatch", false, {
      from: msg.from,
      referencePeer,
      localHash: msg.localHash,
      remoteHash: msg.remoteHash,
      messageId: msg.id,
    });
  }

  // -----------------------------
  // Remote CRDT op apply
  // -----------------------------
  private async onRemoteOp(msg: any): Promise<void> {
    const op = msg.op ?? msg.payload?.op;
    if (!op) {
      await this.deps.audit?.log("rt", "op.missing", false, { from: msg.from, id: msg.id });
      return;
    }

    try {
      await this.deps.crdt.applyOp(op);
      await this.deps.audit?.log("crdt", "op.apply", true, { from: msg.from, id: msg.id, opHash: msg.opHash });

      // post-apply: publish local hash soon (publisher loop will cover it)
    } catch (e: any) {
      const err = String(e?.message ?? e);
      const auditEv = await this.deps.audit?.log("crdt", "op.apply_failed", false, { from: msg.from, err, id: msg.id });

      await this.conflictGlue?.onOpApplyFailed({
        from: msg.from,
        opHash: msg.opHash,
        error: err,
        auditId: auditEv?.id,
      });
    }
  }

  // -----------------------------
  // Remote snapshot apply
  // -----------------------------
  private async onRemoteSnapshot(msg: any): Promise<void> {
    const snap = msg.snapshot ?? msg.payload?.snapshot;
    if (!snap?.meta || !("state" in snap)) {
      await this.deps.audit?.log("rt", "snapshot.missing", false, { from: msg.from, id: msg.id });
      return;
    }

    try {
      await this.deps.crdt.importSnapshot(snap);
      await this.deps.audit?.log("crdt", "snapshot.apply", true, { from: msg.from, id: msg.id });
      await this.runDeterminismCheckIfAny();
    } catch (e: any) {
      const err = String(e?.message ?? e);
      const auditEv = await this.deps.audit?.log("crdt", "snapshot.apply_failed", false, { from: msg.from, err, id: msg.id });

      await this.conflictGlue?.onSnapshotApplyFailed({
        from: msg.from,
        error: err,
        auditId: auditEv?.id,
      });
    }
  }

  // -----------------------------
  // NL command relay
  // -----------------------------
  private async onNL(msg: any): Promise<void> {
    const text = msg.text ?? msg.payload?.text;
    if (!text || !this.deps.nl) return;

    const auditEv = await this.deps.audit?.log("nl", "nl.rx", true, { from: msg.from, id: msg.id, text });
    const res = await this.deps.nl.exec(text, { from: msg.from, messageId: msg.id });

    await this.deps.audit?.log("nl", "nl.exec", res.ok, { from: msg.from, requestAuditId: auditEv?.id, res });
  }

  // -----------------------------
  // Publish hello/meta
  // -----------------------------
  private async publishHello(): Promise<void> {
    const meta = await this.deps.crdt.getMeta();

    const hello = {
      v: 1,
      kind: "hello",
      id: `h_${nowMs().toString(16)}`,
      from: this.cfg.clientTag,
      to: null,
      atMs: nowMs(),
      meta: {
        schemaVersion: meta.schemaVersion,
        stateHash: meta.stateHash,
        atMs: meta.atMs,
      },
    };

    await this.deps.transport.send(hello);
    await this.deps.presence?.setSelf?.(hello.meta);

    await this.deps.audit?.log("rt", "hello.send", true, { meta: hello.meta });
  }

  private startPeriodicPublisher(transport: RTTransport, crdt: CRDTProvider<State>): () => void {
    let alive = true;

    const tick = async () => {
      if (!alive || this.state !== "running") return;

      try {
        const meta = await crdt.getMeta();
        const msg = {
          v: 1,
          kind: "hash_publish",
          id: `hp_${nowMs().toString(16)}`,
          from: this.cfg.clientTag,
          to: null,
          atMs: nowMs(),
          meta: {
            schemaVersion: meta.schemaVersion,
            stateHash: meta.stateHash,
            atMs: meta.atMs,
          },
        };
        await transport.send(msg);
        await this.deps.presence?.setSelf?.(msg.meta);
        await this.deps.audit?.log("rt", "hash_publish.send", true, { stateHash: meta.stateHash });
      } catch (e: any) {
        const err = String(e?.message ?? e);
        await this.deps.audit?.log("rt", "hash_publish.send", false, { err });
        await this.conflictGlue?.onTransportError({ error: err, where: "hash_publish" });
      }
    };

    const interval = setInterval(() => void tick(), this.cfg.publishHashEveryMs);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }

  private async runDeterminismCheckIfAny(): Promise<void> {
    if (!this.cfg.determinismCheckFn || !this.deps.syncHealth) return;

    try {
      const r = await this.cfg.determinismCheckFn();
      this.deps.syncHealth.setDeterminismCheck({
        v: 1,
        ok: r.ok,
        checkedAtMs: nowMs(),
        source: r.source,
        total: r.total,
        mismatches: r.mismatches,
        firstMismatch: r.firstMismatch,
      });
      await this.deps.audit?.log("system", "determinism.check", r.ok, r);
    } catch (e: any) {
      const err = String(e?.message ?? e);
      this.deps.syncHealth.setDeterminismCheck({
        v: 1,
        ok: false,
        checkedAtMs: nowMs(),
        source: "kernel",
        mismatches: 1,
        firstMismatch: { error: err },
      });
      await this.deps.audit?.log("system", "determinism.check", false, { error: err });
    }
  }
}
