// ==========================================
// REAL-TIME COLLAB — A12 (HARDENED)
// Minimal WebSocket collab server: snapshot + linear ops + ack.
// Conflict strategy: if baseVersion != current, reject op and send fresh snapshot.
// ==========================================

import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import type { CollabMsg, DocId, ClientId } from "../protocol";

type Json = any;

interface DocState {
  docId: DocId;
  version: number;
  state: Json; // your canonical doc (e.g., synthmuscle project state)
}

interface ClientCtx {
  ws: WebSocket;
  clientId: ClientId;
  docId: DocId | null;
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isMsg(x: any): x is CollabMsg {
  return x && typeof x === "object" && typeof x.t === "string";
}

function send(ws: WebSocket, msg: CollabMsg): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface CollabServerOptions {
  port: number;
  // Optional: initial documents
  initialDocs?: Array<{ docId: DocId; state: Json }>;
  // Max message bytes (defense)
  maxMessageBytes?: number;
}

export class CollabWSServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private docs = new Map<DocId, DocState>();
  private clients = new Set<ClientCtx>();
  private maxMessageBytes: number;

  constructor(opts: CollabServerOptions) {
    this.maxMessageBytes = opts.maxMessageBytes ?? 256_000;

    for (const d of opts.initialDocs ?? []) {
      this.docs.set(d.docId, { docId: d.docId, version: 0, state: d.state });
    }

    this.server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("collab ok\n");
    });

    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on("connection", (ws) => this.onConn(ws));

    this.server.listen(opts.port);
  }

  close(): void {
    for (const c of this.clients) {
      try {
        c.ws.close();
      } catch {}
    }
    try {
      this.wss.close();
    } catch {}
    try {
      this.server.close();
    } catch {}
  }

  private onConn(ws: WebSocket): void {
    const clientId = randomUUID();
    const ctx: ClientCtx = { ws, clientId, docId: null };
    this.clients.add(ctx);

    ws.on("message", (buf) => this.onMessage(ctx, buf));
    ws.on("close", () => this.onClose(ctx));
    ws.on("error", () => this.onClose(ctx));

    // No unsolicited hello; client must send hello first.
  }

  private onClose(ctx: ClientCtx): void {
    this.clients.delete(ctx);
  }

  private getOrCreateDoc(docId: DocId): DocState {
    const existing = this.docs.get(docId);
    if (existing) return existing;
    const d: DocState = { docId, version: 0, state: {} };
    this.docs.set(docId, d);
    return d;
  }

  private onMessage(ctx: ClientCtx, buf: WebSocket.RawData): void {
    const raw = typeof buf === "string" ? buf : buf.toString("utf8");
    if (raw.length > this.maxMessageBytes) {
      send(ctx.ws, { t: "error", code: "MSG_TOO_LARGE", message: "Message too large." });
      return;
    }

    const parsed = safeJsonParse(raw);
    if (!isMsg(parsed)) {
      send(ctx.ws, { t: "error", code: "BAD_MSG", message: "Invalid message." });
      return;
    }

    switch (parsed.t) {
      case "hello": {
        const docId = String(parsed.docId ?? "");
        if (!docId) {
          send(ctx.ws, { t: "error", code: "NO_DOC", message: "docId required." });
          return;
        }
        ctx.docId = docId;
        const doc = this.getOrCreateDoc(docId);

        send(ctx.ws, {
          t: "snapshot",
          docId,
          version: doc.version,
          state: doc.state,
        });
        return;
      }

      case "op": {
        if (!ctx.docId) {
          send(ctx.ws, { t: "error", code: "NO_SESSION", message: "Send hello first." });
          return;
        }
        const doc = this.getOrCreateDoc(ctx.docId);
        const opId = String(parsed.opId ?? "");
        const baseVersion = Number(parsed.baseVersion);

        if (!opId) {
          send(ctx.ws, { t: "error", code: "NO_OPID", message: "opId required." });
          return;
        }
        if (!Number.isInteger(baseVersion) || baseVersion < 0) {
          send(ctx.ws, { t: "error", code: "BAD_VERSION", message: "baseVersion invalid." });
          return;
        }

        // Conflict check
        if (baseVersion !== doc.version) {
          send(ctx.ws, { t: "error", code: "VERSION_MISMATCH", message: "Out of date. Resync." });
          send(ctx.ws, { t: "snapshot", docId: doc.docId, version: doc.version, state: doc.state });
          return;
        }

        // Apply patch — server assumes patch is the FULL new state or a partial patch.
        // Hardened: simplest, safest rule until CRDT is introduced:
        //   - patch = { $set: <newState> } OR { path: "a.b", value: ... } list etc.
        // You can swap this to RFC6902 JSON Patch later.
        const next = applyServerPatch(doc.state, parsed.patch);
        doc.state = next;
        doc.version += 1;

        // Ack sender
        send(ctx.ws, { t: "ack", docId: doc.docId, opId, newVersion: doc.version });

        // Broadcast op to other clients in same doc
        for (const c of this.clients) {
          if (c === ctx) continue;
          if (c.docId !== doc.docId) continue;
          send(c.ws, {
            t: "op",
            docId: doc.docId,
            baseVersion: doc.version - 1,
            opId,
            patch: parsed.patch,
          });
        }
        return;
      }

      case "presence": {
        // Best-effort broadcast
        if (!ctx.docId) return;
        for (const c of this.clients) {
          if (c === ctx) continue;
          if (c.docId !== ctx.docId) continue;
          send(c.ws, {
            t: "presence",
            docId: ctx.docId,
            clientId: ctx.clientId,
            cursor: (parsed as any).cursor,
            selection: (parsed as any).selection,
          });
        }
        return;
      }

      default:
        send(ctx.ws, { t: "error", code: "UNSUPPORTED", message: `Unsupported msg type: ${parsed.t}` });
        return;
    }
  }
}

/**
 * Server patch format (HARDENED MINIMAL):
 *   1) { $set: any } replaces full document.
 *   2) { $merge: object } shallow merge at root.
 *   3) [{ path: "a.b.c", value: any }] list of set operations.
 */
function applyServerPatch(state: any, patch: any): any {
  // Full replace
  if (patch && typeof patch === "object" && "$set" in patch) {
    return (patch as any).$set;
  }
  // Root shallow merge
  if (patch && typeof patch === "object" && "$merge" in patch) {
    const m = (patch as any).$merge;
    if (m && typeof m === "object" && !Array.isArray(m)) {
      return { ...(state ?? {}), ...m };
    }
    return state;
  }
  // Path sets
  if (Array.isArray(patch)) {
    const next = structuredClone(state ?? {});
    for (const op of patch) {
      if (!op || typeof op !== "object") continue;
      const path = String(op.path ?? "");
      if (!path) continue;
      setByPath(next, path, (op as any).value);
    }
    return next;
  }
  // Unknown patch: ignore for safety
  return state;
}

function setByPath(obj: any, path: string, value: any): void {
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

// For quick local run:
// new CollabWSServer({ port: 8787 });
