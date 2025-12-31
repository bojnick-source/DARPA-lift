// ==========================================
// AUDIT LOGGING (JSONL + HASH CHAIN) — A34 (HARDENED)
// Cross-platform SHA-256 helper.
// Browser: crypto.subtle; Node: crypto.
// ==========================================

export async function sha256Hex(inputUtf8: string): Promise<string> {
  // Browser path
  const g: any = globalThis as any;
  if (g.crypto?.subtle?.digest) {
    const enc = new TextEncoder();
    const buf = enc.encode(inputUtf8);
    const digest = await g.crypto.subtle.digest("SHA-256", buf);
    return bufToHex(new Uint8Array(digest));
  }

  // Node path
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(inputUtf8, "utf8").digest("hex");
  } catch {
    // No crypto available => return empty (still logs JSONL, but no tamper evidence)
    return "";
  }
}

function bufToHex(b: Uint8Array): string {
  let out = "";
  for (const x of b) out += x.toString(16).padStart(2, "0");
  return out;
}
