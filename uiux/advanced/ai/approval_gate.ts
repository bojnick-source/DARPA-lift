// ==========================================
// SANDBOXED AI TOOL-CALL LAYER — A53 (HARDENED)
// Pluggable approval interface (UI can implement modal, biometric, etc.).
// ==========================================

export interface ApprovalRequest {
  title: string;
  summary: string;
  actions: any[];
}

export interface ApprovalGate {
  requestApproval(req: ApprovalRequest): Promise<boolean>;
}

export class AutoApproveGate implements ApprovalGate {
  async requestApproval(_req: ApprovalRequest): Promise<boolean> {
    return true;
  }
}
