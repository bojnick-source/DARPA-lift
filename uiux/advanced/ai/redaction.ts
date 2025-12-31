// ==========================================
// ADVANCED FEATURES — A10 (HARDENED)
// Default redaction: remove large payloads / sensitive traces before AI call.
// ==========================================

import type { AIRequest } from "./assist_contract";

export function defaultRedact(req: AIRequest): AIRequest {
  const r = structuredClone(req);

  // Remove large blobs / raw logs by default
  if (r.context?.lastRunSummary && typeof r.context.lastRunSummary === "object") {
    // Keep summary only if present
    const s: any = r.context.lastRunSummary;
    r.context.lastRunSummary = {
      runId: s.runId ?? s.run_id ?? undefined,
      keyMetrics: s.metrics ?? undefined,
      failures: s.failures ?? undefined,
    };
  }

  // Truncate error traces to prevent dumping huge logs
  if (typeof r.context?.errorTrace === "string" && r.context.errorTrace.length > 2000) {
    r.context.errorTrace = r.context.errorTrace.slice(0, 2000) + "\n…(truncated)";
  }

  return r;
}
