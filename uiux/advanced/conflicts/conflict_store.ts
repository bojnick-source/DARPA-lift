// ==========================================
// CONFLICT STORE — A206 (HARDENED)
// FILE: uiux/advanced/conflicts/conflict_store.ts
// ==========================================

import type {
  ConflictCounts,
  ConflictItem,
  ConflictKind,
  ConflictPolicy,
  ConflictQuery,
  ConflictSeverity,
  ConflictStatus,
} from "./conflict_types";
import { makeConflictId } from "./conflict_id";

function nowMs() {
  return Date.now();
}

function clampLimit(n: number | undefined, max: number) {
  if (n == null) return max;
  return Math.max(1, Math.min(max, n));
}

export class ConflictStore {
  private localClientTag: string;
  private policy: ConflictPolicy;

  private items = new Map<string, ConflictItem>();
  private order: string[] = []; // newest last

  private subs = new Set<() => void>();

  constructor(opts: { localClientTag: string; policy?: Partial<ConflictPolicy> }) {
    this.localClientTag = opts.localClientTag;

    this.policy = {
      v: 1,
      maxItems: opts.policy?.maxItems ?? 2000,
      autoAck: {
        enabled: opts.policy?.autoAck?.enabled ?? true,
        severities: opts.policy?.autoAck?.severities ?? ["info"],
        kinds: opts.policy?.autoAck?.kinds ?? ["transport_error"],
      },
      purge: {
        enabled: opts.policy?.purge?.enabled ?? true,
        resolvedTTLms: opts.policy?.purge?.resolvedTTLms ?? 60 * 60 * 1000, // 1h
        ignoredTTLms: opts.policy?.purge?.ignoredTTLms ?? 15 * 60 * 1000,  // 15m
      },
    };
  }

  onChange(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private emit() {
    for (const cb of this.subs) cb();
  }

  getPolicy(): ConflictPolicy {
    return this.policy;
  }

  setPolicy(p: Partial<ConflictPolicy>) {
    this.policy = {
      ...this.policy,
      ...p,
      autoAck: { ...this.policy.autoAck, ...(p.autoAck ?? {}) },
      purge: { ...this.policy.purge, ...(p.purge ?? {}) },
    };
    this.emit();
  }

  // Purge TTL and trim max
  private cleanup() {
    if (this.policy.purge.enabled) {
      const t = nowMs();
      const shouldRemove: string[] = [];

      for (const id of this.order) {
        const it = this.items.get(id);
        if (!it) continue;

        if (it.status === "resolved" && t - it.updatedAtMs > this.policy.purge.resolvedTTLms) shouldRemove.push(id);
        if (it.status === "ignored" && t - it.updatedAtMs > this.policy.purge.ignoredTTLms) shouldRemove.push(id);
      }

      if (shouldRemove.length) {
        for (const id of shouldRemove) this.items.delete(id);
        this.order = this.order.filter((id) => this.items.has(id));
      }
    }

    // trim to maxItems (drop oldest)
    const max = this.policy.maxItems;
    if (this.order.length > max) {
      const excess = this.order.length - max;
      const drop = this.order.slice(0, excess);
      for (const id of drop) this.items.delete(id);
      this.order = this.order.slice(excess);
    }
  }

  counts(): ConflictCounts {
    let open = 0,
      acked = 0,
      resolved = 0,
      ignored = 0,
      criticalOpen = 0;

    for (const it of this.items.values()) {
      if (it.status === "open") {
        open++;
        if (it.severity === "critical") criticalOpen++;
      } else if (it.status === "acked") acked++;
      else if (it.status === "resolved") resolved++;
      else if (it.status === "ignored") ignored++;
    }

    return { open, acked, resolved, ignored, criticalOpen };
  }

  list(q?: ConflictQuery): ConflictItem[] {
    this.cleanup();

    const query = q ?? {};
    const limit = clampLimit(query.limit, 500);

    let out = this.order
      .slice()
      .reverse()
      .map((id) => this.items.get(id)!)
      .filter(Boolean);

    if (query.status && query.status !== "any") out = out.filter((x) => x.status === query.status);
    if (query.severity && query.severity !== "any") out = out.filter((x) => x.severity === query.severity);
    if (query.kind && query.kind !== "any") out = out.filter((x) => x.kind === query.kind);

    if (query.text) {
      const t = query.text.toLowerCase();
      out = out.filter((x) => (x.title + " " + (x.detail ?? "")).toLowerCase().includes(t));
    }

    return out.slice(0, limit);
  }

  get(id: string): ConflictItem | undefined {
    return this.items.get(id);
  }

  async add(input: {
    severity: ConflictSeverity;
    kind: ConflictKind;
    title: string;
    detail?: string;
    sourcePeer?: string | null;
    payload?: any;
    related?: ConflictItem["related"];
    recommendedAction?: ConflictItem["recommendedAction"];
  }): Promise<ConflictItem> {
    const createdAtMs = nowMs();

    const id = await makeConflictId({
      localClientTag: this.localClientTag,
      kind: input.kind,
      severity: input.severity,
      sourcePeer: input.sourcePeer ?? null,
      related: input.related ?? undefined,
      payload: input.payload ?? undefined,
    });

    const existing = this.items.get(id);
    if (existing) {
      // Update existing (do not overwrite status unless it was resolved/ignored)
      const next: ConflictItem = {
        ...existing,
        updatedAtMs: createdAtMs,
        title: input.title ?? existing.title,
        detail: input.detail ?? existing.detail,
        payload: input.payload ?? existing.payload,
        related: { ...(existing.related ?? {}), ...(input.related ?? {}) },
        recommendedAction: input.recommendedAction ?? existing.recommendedAction,
        // if it was resolved/ignored, keep it resolved/ignored unless new severity escalates
        severity: escalateSeverity(existing.severity, input.severity),
      };

      this.items.set(id, next);
      this.cleanup();
      this.emit();
      return next;
    }

    // Auto-ack policy
    const autoAck =
      this.policy.autoAck.enabled &&
      this.policy.autoAck.severities.includes(input.severity) &&
      this.policy.autoAck.kinds.includes(input.kind);

    const it: ConflictItem = {
      v: 1,
      id,
      createdAtMs,
      updatedAtMs: createdAtMs,
      localClientTag: this.localClientTag,
      severity: input.severity,
      kind: input.kind,
      status: autoAck ? "acked" : "open",
      sourcePeer: input.sourcePeer ?? null,
      title: input.title,
      detail: input.detail,
      payload: input.payload,
      related: input.related,
      recommendedAction: input.recommendedAction ?? "none",
    };

    this.items.set(id, it);
    this.order.push(id);

    this.cleanup();
    this.emit();
    return it;
  }

  setStatus(id: string, status: ConflictStatus): boolean {
    const it = this.items.get(id);
    if (!it) return false;

    this.items.set(id, { ...it, status, updatedAtMs: nowMs() });
    this.cleanup();
    this.emit();
    return true;
  }

  ack(id: string): boolean {
    const it = this.items.get(id);
    if (!it) return false;
    if (it.status !== "open") return false;
    return this.setStatus(id, "acked");
  }

  resolve(id: string): boolean {
    const it = this.items.get(id);
    if (!it) return false;
    if (it.status === "resolved") return false;
    return this.setStatus(id, "resolved");
  }

  ignore(id: string): boolean {
    const it = this.items.get(id);
    if (!it) return false;
    if (it.status === "ignored") return false;
    return this.setStatus(id, "ignored");
  }

  // Bulk actions (policy-driven)
  autoAckEligible(): { acked: number } {
    let acked = 0;
    for (const id of this.order) {
      const it = this.items.get(id);
      if (!it) continue;
      if (it.status !== "open") continue;

      const eligible =
        this.policy.autoAck.enabled &&
        this.policy.autoAck.severities.includes(it.severity) &&
        this.policy.autoAck.kinds.includes(it.kind);

      if (eligible) {
        this.items.set(id, { ...it, status: "acked", updatedAtMs: nowMs() });
        acked++;
      }
    }
    if (acked) {
      this.cleanup();
      this.emit();
    }
    return { acked };
  }
}

function severityRank(s: ConflictSeverity): number {
  return s === "critical" ? 2 : s === "warn" ? 1 : 0;
}

function escalateSeverity(a: ConflictSeverity, b: ConflictSeverity): ConflictSeverity {
  return severityRank(b) > severityRank(a) ? b : a;
}
