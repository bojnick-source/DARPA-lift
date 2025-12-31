// ==========================================
// TOAST -> DRAWER WIRING — A83 (HARDENED)
// Wraps ConflictToasts and opens drawer on toast click.
// ==========================================

import React, { useEffect, useState } from "react";
import type { ConflictBus } from "./conflict_bus";
import type { ConflictEvent } from "./conflict_types";
import { ConflictDetailsDrawer, type ConflictDrawerActions } from "./ConflictDetailsDrawer";
import { ConflictToasts } from "./ConflictToasts";

export function ConflictUIRoot(props: {
  bus: ConflictBus;
  actions: ConflictDrawerActions;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ConflictEvent | undefined>(undefined);

  // Small extension: monkey-patch bus to also notify selection on emit if desired.
  // If you prefer, add a dedicated "onSelect" event in ConflictToasts.
  useEffect(() => {
    const off = props.bus.on((e) => {
      // Default behavior: select most recent conflict (can be disabled)
      setSelected(e);
    });
    return off;
  }, [props.bus]);

  return (
    <>
      <ConflictToasts
        bus={props.bus}
        actions={{
          openPanel: props.actions.openPanel,
          setReferencePeer: undefined,
          forcePublishHashes: undefined,
          resyncFromCRDT: props.actions.hardResyncFromCRDT,
        }}
        onSelect={(e) => {
          setSelected(e);
          setOpen(true);
        }}
      />

      <ConflictDetailsDrawer
        open={open}
        conflict={selected}
        onClose={() => setOpen(false)}
        actions={props.actions}
      />

      {/* Minimal trigger: click anywhere on bottom-right to open last conflict */}
      <div
        style={{
          position: "fixed",
          right: 14,
          bottom: 14,
          width: 24,
          height: 24,
          opacity: 0,
          zIndex: 1300,
        }}
        onClick={() => setOpen(true)}
        aria-hidden="true"
      />
    </>
  );
}
