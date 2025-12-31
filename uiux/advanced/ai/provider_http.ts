// ==========================================
// ADVANCED FEATURES — A9 (HARDENED)
// HTTP AI provider (backend-agnostic). Safe defaults: timeout, redaction hook, strict parsing.
// ==========================================

import type { AIProvider, AIRequest, AIResponse } from "./assist_contract";

export type RedactFn = (req: AIRequest) => AIRequest;

export interface HttpAIProviderOptions {
  endpoint: string;          // e.g. "/api/ai"
  timeoutMs?: number;        // default 15000
  redact?: RedactFn;         // optional sanitizer before send
  headers?: Record<string, string>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`AI timeout after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function safeParseAIResponse(x: any): AIResponse {
  if (!x || typeof x !== "object") return { text: "Invalid AI response (non-object)." };
  const text = typeof x.text === "string" ? x.text : "Invalid AI response (missing text).";
  const actions = Array.isArray((x as any).actions) ? (x as any).actions : undefined;
  const confidence = typeof (x as any).confidence === "number" ? (x as any).confidence : undefined;
  return { text, actions, confidence };
}

export class HttpAIProvider implements AIProvider {
  private endpoint: string;
  private timeoutMs: number;
  private redact?: RedactFn;
  private headers: Record<string, string>;

  constructor(opts: HttpAIProviderOptions) {
    if (!opts?.endpoint) throw new Error("HttpAIProviderOptions.endpoint is required.");
    this.endpoint = opts.endpoint;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.redact = opts.redact;
    this.headers = opts.headers ?? {};
  }

  async call(req: AIRequest): Promise<AIResponse> {
    const safeReq = this.redact ? this.redact(req) : req;

    const body = JSON.stringify(safeReq);
    const resp = await withTimeout(
      fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body,
      }),
      this.timeoutMs
    );

    if (!resp.ok) {
      return { text: `AI request failed (${resp.status})`, actions: [] };
    }

    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      return { text: "AI response was not valid JSON.", actions: [] };
    }

    return safeParseAIResponse(data);
  }
}
