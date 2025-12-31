// ==========================================
// CANONICAL SERIALIZATION — A171 (HARDENED)
// FILE: uiux/advanced/crdt/canonicalize.ts
// Deterministic JSON stringify with stable key ordering.
// This is the foundation of invariant hashing (replay + verification).
// ==========================================

function isObj(x: any): x is Record<string, any> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function sortKeys(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const keys = Object.keys(obj).sort();
  for (const k of keys) out[k] = obj[k];
  return out;
}

function canonicalizeInner(x: any, depth: number, maxDepth: number): any {
  if (depth > maxDepth) return "[MAX_DEPTH]";
  if (x === null) return null;

  const t = typeof x;
  if (t === "number") {
    // Normalize -0 and NaN/Infinity
    if (!Number.isFinite(x)) return String(x);
    if (Object.is(x, -0)) return 0;
    return x;
  }
  if (t === "string" || t === "boolean") return x;

  // Dates -> ISO (do NOT hash locale strings)
  if (x instanceof Date) return x.toISOString();

  // Arrays
  if (Array.isArray(x)) return x.map((v) => canonicalizeInner(v, depth + 1, maxDepth));

  // Typed arrays / ArrayBuffer -> base64 marker (avoid huge buffers by default)
  if (ArrayBuffer.isView(x)) return { __typed__: x.constructor?.name ?? "TypedArray", __len__: x.byteLength };
  if (x instanceof ArrayBuffer) return { __arraybuffer__: true, __len__: x.byteLength };

  // Objects
  if (isObj(x)) {
    const s = sortKeys(x);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(s)) {
      out[k] = canonicalizeInner(v, depth + 1, maxDepth);
    }
    return out;
  }

  // Fallback
  return String(x);
}

export function canonicalize(value: any, opts?: { maxDepth?: number }): any {
  const maxDepth = opts?.maxDepth ?? 64;
  return canonicalizeInner(value, 0, maxDepth);
}

export function canonicalJSONStringify(value: any): string {
  return JSON.stringify(canonicalize(value));
}
