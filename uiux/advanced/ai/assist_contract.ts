// ==========================================
// SANDBOXED AI TOOL-CALL LAYER — A55 (HARDENED)
// Standard AI provider contract.
// "actions" are suggestions only; sandbox enforces everything.
// ==========================================

export interface AIRequest {
  intent: "translate_command" | "explain" | "summarize";
  context: any;
}

export interface AIResponse {
  text: string;
  actions?: any[];
  // optional: model confidence / rationale (not executed)
  confidence?: number;
}

export interface AIProvider {
  call(req: AIRequest): Promise<AIResponse>;
}
