// ==========================================
// CRDT UPGRADE (Yjs) — A29 (HARDENED)
// Requires: vitest or jest. Demonstrates convergence across two docs.
// ==========================================

import * as Y from "yjs";
import { getYRoot } from "../yjs_types";
import { setYByPath } from "../path_ops";

function sync(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a);
  Y.applyUpdate(b, ua);
  const ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
}

test("two writers converge", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const ra = getYRoot(a);
  const rb = getYRoot(b);

  a.transact(() => setYByPath(ra.state, "opt.bounds.lo", [0, 0, 0]));
  b.transact(() => setYByPath(rb.state, "opt.bounds.hi", [1, 1, 1]));

  sync(a, b);

  expect(ra.state.toJSON()).toEqual(rb.state.toJSON());
});
