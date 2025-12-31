// ==========================================
// CRDT UPGRADE (Yjs) — A23 (HARDENED)
// Canonical Yjs document layout for Olytheon UI state.
// ==========================================

import * as Y from "yjs";

export type YRoot = {
  // nested map containing your app state (ui., opt., mc., gates., etc.)
  state: Y.Map<any>;
  // metadata (optional)
  meta: Y.Map<any>;
};

export function getYRoot(doc: Y.Doc): YRoot {
  const state = doc.getMap("state");
  const meta = doc.getMap("meta");
  return { state, meta };
}
