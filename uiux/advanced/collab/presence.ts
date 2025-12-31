// ==========================================
// PRESENCE HELPERS — A117 (HARDENED)
// Awareness helpers for roster + local user.
// ==========================================

export interface PresenceUser {
  clientTag: string;
  name?: string;
  role?: string;
  lastSeenMs?: number;
}

export function setLocalPresence(awareness: any, user: PresenceUser) {
  awareness.setLocalStateField("user", {
    clientTag: user.clientTag,
    name: user.name ?? undefined,
    role: user.role ?? undefined,
    lastSeenMs: Date.now(),
  });
}

export function listPresence(awareness: any): PresenceUser[] {
  const states = awareness.getStates?.() ?? new Map();
  const out: PresenceUser[] = [];
  states.forEach((st: any) => {
    const u = st?.user;
    if (u?.clientTag) out.push(u);
  });
  return out.sort((a, b) => String(a.clientTag).localeCompare(String(b.clientTag)));
}
