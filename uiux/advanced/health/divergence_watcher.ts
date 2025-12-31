// ==========================================
// PERIODIC DIVERGENCE CHECK — A45 (HARDENED)
// Periodically compares:
//   - local UI state hash
//   - a reference hash from another client (optional), OR
//   - last saved replay hash in audit
//
// This is intentionally conservative: it does not spam heavy replay unless enabled.
// ==========================================

import { sha256Hex } from "../audit/hash";
import type { AuditLogger } from "../audit/audit_logger";

export interface DivergenceStatus {
  ok: boolean;
  checkedAtMs: number;
  localHash: string;
  refHash?: string;
  mismatched?: boolean;
  note?: string;
}

export interface DivergenceWatcherOptions {
  intervalMs: number;             // e.g. 10_000
  getLocalState: () => any;        // UI projection snapshot
  // Optional: reference hash from another client or server
  getReferenceHash?: () => Promise<string | null>;
  // Optional: push status into UI
  onStatus?: (s: DivergenceStatus) => void;
  // Optional: audit
  audit?: AuditLogger;
  // Defense: if state is huge, skip hashing (prevents UI freeze)
  maxStateBytes?: number;          // default 1MB
}

function stableStringify(x: any): string {
  return JSON.stringify(sortRec(x));
}
function sortRec(x: any): any {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(sortRec);
  const keys = Object.keys(x).sort();
  const out: any = {};
  for (const k of keys) out[k] = sortRec(x[k]);
  return out;
}

export class DivergenceWatcher {
  private opts: Required<Omit<DivergenceWatcherOptions, "getReferenceHash" | "onStatus" | "audit">> &
    Pick<DivergenceWatcherOptions, "getReferenceHash" | "onStatus" | "audit">;

  private timer: any = null;
  private running = false;

  constructor(opts: DivergenceWatcherOptions) {
    this.opts = {
      maxStateBytes: 1_000_000,
      ...opts,
    } as any;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
    // run immediately
    this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const snap = this.opts.getLocalState() ?? {};
      const stable = stableStringify(snap);

      if (stable.length > this.opts.maxStateBytes) {
        const s: DivergenceStatus = {
          ok: true,
          checkedAtMs: Date.now(),
          localHash: "",
          note: `Skipped: state > ${this.opts.maxStateBytes} bytes`,
        };
        this.opts.onStatus?.(s);
        await this.opts.audit?.log("error", false, { type: "divergence_watcher", note: s.note });
        return;
      }

      const localHash = await sha256Hex(stable);

      let refHash: string | null = null;
      if (this.opts.getReferenceHash) {
        try {
          refHash = await this.opts.getReferenceHash();
        } catch {
          refHash = null;
        }
      }

      const mismatched = !!(refHash && localHash && refHash !== localHash);

      const status: DivergenceStatus = {
        ok: !mismatched,
        checkedAtMs: Date.now(),
        localHash,
        refHash: refHash ?? undefined,
        mismatched: mismatched || undefined,
      };

      this.opts.onStatus?.(status);

      if (this.opts.audit) {
        await this.opts.audit.log("crdt.remote_apply", true, {
          type: "divergence_check",
          ok: status.ok,
          localHash: status.localHash,
          refHash: status.refHash ?? null,
        });
      }
    } finally {
      this.running = false;
    }
  }
}
