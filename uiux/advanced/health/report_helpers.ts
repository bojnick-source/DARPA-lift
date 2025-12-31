// ==========================================
// HEALTH REPORT HELPERS — A94 (HARDENED)
// ==========================================

export interface SnapshotProvider {
  getLocal(): any;
  getReference(): Promise<any>;
}

export async function loadSnapshots(p: SnapshotProvider): Promise<{ local: any; ref: any }> {
  const local = p.getLocal();
  const ref = await p.getReference();
  return { local, ref };
}
