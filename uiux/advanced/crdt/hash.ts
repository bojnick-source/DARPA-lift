// ==========================================
// SHA-256 HASHING — A172 (HARDENED)
// FILE: uiux/advanced/crdt/hash.ts
// Browser (WebCrypto) first, Node fallback.
// ==========================================

export async function sha256Hex(input: string): Promise<string> {
  // WebCrypto (browser / modern runtimes)
  const g: any = globalThis as any;

  if (g?.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const data = new TextEncoder().encode(input);
    const digest = await g.crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Node fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(input, "utf8").digest("hex");
  } catch {
    // Last resort: non-crypto hash (NOT acceptable for production correctness)
    // Kept to avoid hard crash in unknown runtimes.
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fnv1a_${(h >>> 0).toString(16)}`;
  }
}
