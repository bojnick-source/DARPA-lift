// ==========================================
// APP BOOTSTRAP EXAMPLE — A256 (HARDENED)
// FILE: uiux/advanced/platform/AppBootstrap.tsx
// Single place to decide layout + capability gates and pass to app.
// ==========================================

import React, { useMemo } from "react";
import { computeCapabilities } from "./capabilities";
import { decideUI } from "./adaptive_ui";

export function AppBootstrap(props: { children: (x: { caps: any; ui: any }) => React.ReactNode }) {
  const caps = useMemo(() => computeCapabilities(), []);
  const ui = useMemo(() => decideUI(caps), [caps]);

  return <>{props.children({ caps, ui })}</>;
}
