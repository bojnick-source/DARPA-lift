// ==========================================
// ROLE-BASED PERMISSIONS — A48 (HARDENED)
// Role model + permission matrix for NL + UI actions.
// ==========================================

export type Role = "viewer" | "operator" | "admin";

export type Permission =
  | "ui.read"
  | "ui.write"
  | "panel.open"
  | "pipeline.run"
  | "pipeline.run.optimize"
  | "pipeline.run.montecarlo"
  | "pipeline.run.mjcf"
  | "audit.export"
  | "collab.manage"
  | "settings.write";

export interface RolePolicy {
  role: Role;
  permissions: Permission[];
}

export const ROLE_POLICIES: Record<Role, RolePolicy> = {
  viewer: {
    role: "viewer",
    permissions: ["ui.read", "panel.open"],
  },
  operator: {
    role: "operator",
    permissions: [
      "ui.read",
      "ui.write",
      "panel.open",
      "pipeline.run",
      "pipeline.run.montecarlo",
      "pipeline.run.mjcf",
      "audit.export",
    ],
  },
  admin: {
    role: "admin",
    permissions: [
      "ui.read",
      "ui.write",
      "panel.open",
      "pipeline.run",
      "pipeline.run.optimize",
      "pipeline.run.montecarlo",
      "pipeline.run.mjcf",
      "audit.export",
      "collab.manage",
      "settings.write",
    ],
  },
};

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_POLICIES[role].permissions.includes(perm);
}
