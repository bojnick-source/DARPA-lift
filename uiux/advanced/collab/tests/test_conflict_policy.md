/*
CONFLICT POLICY SUMMARY (HARDENED)

1) patch.kind = "set" or "merge"
   - STRICT concurrency.
   - If baseVersion != serverVersion => reject + snapshot.
   - Reason: full replace or root merge can stomp unrelated edits.

2) patch.kind = "pathset" with policy "lww_pathset"
   - ALLOWED under stale baseVersion.
   - Server applies sets in arrival order (last write wins per path).
   - Good for form-like state edits: bounds, flags, UI settings, knobs.

If you need *true* multi-writer semantics across arbitrary structures, move to CRDT (Yjs).
*/
