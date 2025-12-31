// ==========================================
// ROLE-BASED PERMISSIONS — A49 (HARDENED)
// Centralized checks used by NL exec + UI buttons.
// ==========================================

import type { Role, Permission } from "./roles";
import { hasPermission } from "./roles";

export interface EnforcementResult {
  ok: boolean;
  reason?: string;
}

export function requirePerm(role: Role, perm: Permission): EnforcementResult {
  if (hasPermission(role, perm)) return { ok: true };
  return { ok: false, reason: `MISSING_PERMISSION:${perm}` };
}

export function requireAny(role: Role, perms: Permission[]): EnforcementResult {
  for (const p of perms) if (hasPermission(role, p)) return { ok: true };
  return { ok: false, reason: `MISSING_ANY_PERMISSION:${perms.join("|")}` };
}
