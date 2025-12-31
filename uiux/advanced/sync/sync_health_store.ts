// ==========================================
// SYNC HEALTH STORE — A213 (HARDENED)
// FILE: uiux/advanced/sync/sync_health_store.ts
// Aggregates reference peer, peer hashes, mismatches, conflicts, determinism, and gate evals.
// ==========================================

import type {
  DeterminismCheck,
  GateBundle,
  HealthSeverity,
  MismatchEvent,
  PeerHash,
  RobustnessGate,
  RobustnessGateEval,
  SyncHealthSnapshot,
} from "./sync_health_types";

function nowMs() {
  return Date.now();
}

function severityRank(s: HealthSeverity): number {
  return s === "critical" ? 2 : s === "warn" ? 1 : 0;
}

function maxSeverity(a: HealthSeverity, b: HealthSeverity): HealthSeverity {
  return severityRank(b) > severityRank(a) ? b : a;
}

export class MismatchBuffer {
  private max: number;
  private items: MismatchEvent[] = [];

  constructor(max = 100) {
    this.max = max;
  }

  add(e: MismatchEvent) {
    this.items.push(e);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  list(): MismatchEvent[] {
    return [...this.items].sort((a, b) => b.atMs - a.atMs);
  }

  clear() {
    this.items = [];
  }
}

export class SyncHealthStore {
  private referencePeer: string | null = null;
  private peers: PeerHash[] = [];
  private mismatches = new MismatchBuffer(100);

  private conflictCounts = { open: 0, acked: 0, resolved: 0, ignored: 0, criticalOpen: 0 };
  private determinism?: DeterminismCheck;

  private gates: GateBundle = { v: 1, gates: [] };

  private subs = new Set<() => void>();

  onChange(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private emit() {
    for (const cb of this.subs) cb();
  }

  setReferencePeer(peer: string | null) {
    this.referencePeer = peer;
    this.emit();
  }

  setPeers(peers: PeerHash[]) {
    this.peers = [...peers];
    this.emit();
  }

  addMismatch(e: MismatchEvent) {
    this.mismatches.add(e);
    this.emit();
  }

  setConflictCounts(c: { open: number; acked: number; resolved: number; ignored: number; criticalOpen: number }) {
    this.conflictCounts = { ...c };
    this.emit();
  }

  setDeterminismCheck(c: DeterminismCheck) {
    this.determinism = c;
    this.emit();
  }

  setGates(gates: RobustnessGate[]) {
    this.gates = { v: 1, gates: [...gates] };
    this.emit();
  }

  // Evaluate gates from a metrics dictionary (e.g. Monte Carlo aggregate metrics)
  evaluateGates(metrics: Record<string, number | undefined>) {
    const evals: RobustnessGateEval[] = this.gates.gates.map((g) => {
      const value = metrics[g.name];
      const ok = value == null ? false : compare(value, g.comparator, g.threshold);

      const severity: HealthSeverity =
        value == null ? "warn" : ok ? "ok" : g.comparator.startsWith("<") ? "critical" : "critical";

      const note =
        value == null
          ? "metric unavailable"
          : ok
          ? "within gate"
          : `violates gate (${g.comparator} ${g.threshold})`;

      return { gate: g, value, ok, severity, note };
    });

    this.gates = {
      ...this.gates,
      evals,
      evaluatedAtMs: nowMs(),
    };

    this.emit();
  }

  snapshot(): SyncHealthSnapshot {
    const mismatches = this.mismatches.list();
    const peers = [...this.peers].sort((a, b) => a.clientTag.localeCompare(b.clientTag));

    let severity: HealthSeverity = "ok";
    let headline: string | undefined;

    // 1) critical conflicts
    if (this.conflictCounts.criticalOpen > 0) {
      severity = "critical";
      headline = `${this.conflictCounts.criticalOpen} critical conflict(s) open`;
    }

    // 2) reference peer mismatch evidence
    if (mismatches.length > 0 && this.referencePeer) {
      severity = maxSeverity(severity, "critical");
      if (!headline) headline = "Reference peer drift detected";
    }

    // 3) determinism failure
    if (this.determinism && !this.determinism.ok) {
      severity = maxSeverity(severity, "critical");
      if (!headline) headline = "Determinism check failed";
    }

    // 4) gate violations
    const gateEvals = this.gates.evals ?? [];
    const gateBad = gateEvals.filter((e) => !e.ok);
    if (gateBad.length > 0) {
      severity = maxSeverity(severity, "warn");
      if (!headline) headline = `${gateBad.length} robustness gate(s) failing`;
    }

    return {
      v: 1,
      atMs: nowMs(),
      referencePeer: this.referencePeer,
      peers,
      mismatches,
      conflictCounts: { ...this.conflictCounts },
      determinism: this.determinism,
      gates: this.gates.gates.length ? this.gates : undefined,
      severity,
      headline,
    };
  }
}

function compare(value: number, cmp: "<=" | "<" | ">=" | ">", threshold: number): boolean {
  if (cmp === "<=") return value <= threshold;
  if (cmp === "<") return value < threshold;
  if (cmp === ">=") return value >= threshold;
  return value > threshold;
}
