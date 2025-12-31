// ==========================================
// MIGRATION UI ROOT — A91 (HARDENED)
// Drop-in wrapper that mounts the migration banner.
// ==========================================

import React from "react";
import type { ConflictBus } from "../../conflict/conflict_bus";
import { MigrationBanner } from "./MigrationBanner";

export function MigrationUIRoot(props: { bus: ConflictBus; room?: string; docId?: string }) {
  return <MigrationBanner bus={props.bus} room={props.room} docId={props.docId} />;
}
