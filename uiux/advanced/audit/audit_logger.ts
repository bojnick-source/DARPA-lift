// ==========================================
// AUDIT LOGGING (JSONL + HASH CHAIN) — A34 (HARDENED)
// JSONL logger with optional SHA-256 hash chaining.
// ==========================================

import type { AuditEvent, AuditEventType } from "./audit_types";
import type { AuditSink } from "./sinks";
import { sha256Hex } from "./hash";

export interface AuditLoggerOptions {
  sessionId: string;
  clientId: string;
  sink: AuditSink;

  // Hardening knobs
  enableHashChain?: boolean; // default true when crypto available
  redact?: (e: AuditEvent) => AuditEvent;
}

export class AuditLogger {
  private opts: Required<AuditLoggerOptions>;
  private prevHash = "";
  private seq = 0;

  constructor(opts: AuditLoggerOptions) {
    this.opts = {
      enableHashChain: true,
      redact: (e) => e,
      ...opts,
    } as Required<AuditLoggerOptions>;
  }

  private monoMs(): number | undefined {
    try {
      const p = (globalThis as any).performance;
      if (p && typeof p.now === "function") return p.now();
      return undefined;
    } catch {
      return undefined;
    }
  }

  async log(type: AuditEventType, ok: boolean, payload?: any, extra?: Partial<AuditEvent>): Promise<void> {
    const base: AuditEvent = {
      v: 1,
      sessionId: this.opts.sessionId,
      clientId: this.opts.clientId,
      tsWallMs: Date.now(),
      tsMonoMs: this.monoMs(),
      type,
      ok,
      payload,
      ...extra,
    };

    // Apply redaction before hashing/writing
    const e = this.opts.redact(base);

    // Hash chain
    if (this.opts.enableHashChain) {
      e.prevHash = this.prevHash || undefined;

      const canon = canonicalLineForHash(e, this.seq++);
      const h = await sha256Hex(canon);
      if (h) {
        e.hash = h;
        this.prevHash = h;
      }
    }

    await this.opts.sink.writeLine(JSON.stringify(e));
  }

  async flush(): Promise<void> {
    await this.opts.sink.flush?.();
  }

  async close(): Promise<void> {
    await this.opts.sink.close?.();
  }
}

function canonicalLineForHash(e: AuditEvent, seq: number): string {
  // Canonicalize minimal fields to keep stable hashing
  // (do not include "hash" itself)
  return JSON.stringify({
    seq,
    v: e.v,
    sessionId: e.sessionId,
    clientId: e.clientId,
    tsWallMs: e.tsWallMs,
    tsMonoMs: e.tsMonoMs ?? null,
    type: e.type,
    ok: e.ok,
    docId: e.docId ?? null,
    room: e.room ?? null,
    runId: e.runId ?? null,
    prevHash: e.prevHash ?? null,
    payload: e.payload ?? null,
  });
}
