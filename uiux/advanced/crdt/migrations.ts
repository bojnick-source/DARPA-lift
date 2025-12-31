// ==========================================
// MIGRATION REGISTRY — A173 (HARDENED)
// FILE: uiux/advanced/crdt/migrations.ts
// Deterministic, explicit schema upgrades for app state.
// ==========================================

export type SchemaVersion = string;

export interface Migration<State> {
  from: SchemaVersion;
  to: SchemaVersion;
  // Must be deterministic (no randomness, no time).
  apply: (s: State) => State;
  note?: string;
}

export class MigrationRegistry<State> {
  private migrations: Migration<State>[] = [];

  register(m: Migration<State>) {
    this.migrations.push(m);
  }

  // Returns upgraded state or throws if no path exists.
  upgrade(state: State, from: SchemaVersion, to: SchemaVersion): { state: State; path: Migration<State>[] } {
    if (from === to) return { state, path: [] };

    // Build adjacency
    const byFrom = new Map<string, Migration<State>[] >();
    for (const m of this.migrations) {
      const list = byFrom.get(m.from) ?? [];
      list.push(m);
      byFrom.set(m.from, list);
    }

    // BFS for shortest path
    const q: Array<{ v: string; state: State; path: Migration<State>[] }> = [{ v: from, state, path: [] }];
    const seen = new Set<string>([from]);

    while (q.length) {
      const cur = q.shift()!;
      const nexts = byFrom.get(cur.v) ?? [];
      for (const m of nexts) {
        const nextV = m.to;
        if (seen.has(nextV)) continue;

        const nextState = m.apply(cur.state);
        const nextPath = [...cur.path, m];

        if (nextV === to) return { state: nextState, path: nextPath };

        seen.add(nextV);
        q.push({ v: nextV, state: nextState, path: nextPath });
      }
    }

    throw new Error(`No migration path from ${from} -> ${to}`);
  }
}
