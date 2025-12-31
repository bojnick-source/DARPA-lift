// ==========================================
// REAL-TIME CONFLICT HANDLING — A17 (HARDENED)
// Conflict policy upgrade:
//   - strict for set/merge
//   - LWW for pathset when policy === "lww_pathset"
// ==========================================

import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import type { CollabMsgV2, DocId, ClientId, Patch, PathSetOp } from "../protocol_v2";

type Json = any;

interface DocState {
  docId: DocId;
  version: number;
  state: Json;
}

interface ClientCtx {
  ws: WebSocket;
  clientId: ClientId;
  docId: DocId | null;
}

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}
function isMsg(x: any): x is CollabMsgV2 {
  return x && typeof x === "object" && typeof x.t === "string";
}
function send(ws: WebSocket, msg: CollabMsgV2): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

export interface CollabServerOptions {
  port: number;
  initialDocs?: Array<{ docId: DocId; state: Json }>;
  maxMessageBytes?: number;
}

export class CollabWSServerV2 {
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
      res.end("collab v2 ok\n");
    });

    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on("connection", (ws) => this.onConn(ws));
    this.server.listen(opts.port);
  }

  close(): void {
    for (const c of this.clients) { try { c.ws.close(); } catch {} }
    try { this.wss.close(); } catch {}
    try { this.server.close(); } catch {}
  }

  private onConn(ws: WebSocket): void {
    const clientId = randomUUID();
    const ctx: ClientCtx = { ws, clientId, docId: null };
    this.clients.add(ctx);

    ws.on("message", (buf) => this.onMessage(ctx, buf));
    ws.on("close", () => this.clients.delete(ctx));
    ws.on("error", () => this.clients.delete(ctx));
  }

  private getOrCreateDoc(docId: DocId): DocState {
    const d = this.docs.get(docId);
    if (d) return d;
    const created: DocState = { docId, version: 0, state: {} };
    this.docs.set(docId, created);
    return created;
  }

  private broadcast(docId: DocId, msg: CollabMsgV2, except?: ClientCtx): void {
    for (const c of this.clients) {
      if (except && c === except) continue;
      if (c.docId !== docId) continue;
      send(c.ws, msg);
    }
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

    if (parsed.t === "hello") {
      const docId = String(parsed.docId ?? "");
      if (!docId) return send(ctx.ws, { t: "error", code: "NO_DOC", message: "docId required." });
      ctx.docId = docId;
      const doc = this.getOrCreateDoc(docId);
      return send(ctx.ws, { t: "snapshot", docId, version: doc.version, state: doc.state });
    }

    if (parsed.t === "op") {
      if (!ctx.docId) return send(ctx.ws, { t: "error", code: "NO_SESSION", message: "Send hello first." });

      const doc = this.getOrCreateDoc(ctx.docId);
      const opId = String(parsed.opId ?? "");
      const baseVersion = Number(parsed.baseVersion);
      const patch: Patch = parsed.patch as any;

      if (!opId) return send(ctx.ws, { t: "error", code: "NO_OPID", message: "opId required." });
      if (!Number.isInteger(baseVersion) || baseVersion < 0) {
        return send(ctx.ws, { t: "error", code: "BAD_VERSION", message: "baseVersion invalid." });
      }
      if (!patch || typeof patch !== "object" || !("kind" in patch)) {
        return send(ctx.ws, { t: "error", code: "BAD_PATCH", message: "patch.kind required." });
      }

      const canLww =
        patch.kind === "pathset" && (patch.policy ?? "lww_pathset") === "lww_pathset";

      // STRICT conflict policy (set/merge) => reject if stale
      if (!canLww && baseVersion !== doc.version) {
        send(ctx.ws, { t: "conflict", docId: doc.docId, opId, applied: false, reason: "VERSION_MISMATCH", serverVersion: doc.version });
        send(ctx.ws, { t: "snapshot", docId: doc.docId, version: doc.version, state: doc.state });
        return;
      }

      // Apply patch
      const next = applyPatch(doc.state, patch, ctx.clientId);
      doc.state = next;
      doc.version += 1;

      // Ack sender
      send(ctx.ws, { t: "ack", docId: doc.docId, opId, newVersion: doc.version });

      // If stale but LWW applied, inform sender it was merged under conflict policy
      if (canLww && baseVersion !== (doc.version - 1)) {
        send(ctx.ws, { t: "conflict", docId: doc.docId, opId, applied: true, reason: "LWW_PATHSET_APPLIED", serverVersion: doc.version });
      }

      // Broadcast op to others (they can apply if their version matches; if not, they request snapshot)
      this.broadcast(
        doc.docId,
        { t: "op", docId: doc.docId, baseVersion: doc.version - 1, opId, patch },
        ctx
      );
      return;
    }

    if (parsed.t === "presence") {
      if (!ctx.docId) return;
      this.broadcast(
        ctx.docId,
        { t: "presence", docId: ctx.docId, clientId: ctx.clientId, cursor: (parsed as any).cursor, selection: (parsed as any).selection },
        ctx
      );
      return;
    }

    send(ctx.ws, { t: "error", code: "UNSUPPORTED", message: `Unsupported msg: ${parsed.t}` });
  }
}

function applyPatch(state: any, patch: Patch, clientId: ClientId): any {
  if (patch.kind === "set") return patch.value;

  if (patch.kind === "merge") {
    const v = patch.value;
    if (!v || typeof v !== "object" || Array.isArray(v)) return state;
    return { ...(state ?? {}), ...v };
  }

  // pathset (conflict-resolvable): last-write-wins per path in arrival order
  const ops = (patch.ops ?? []).filter(Boolean) as PathSetOp[];
  const next = structuredClone(state ?? {});
  for (const op of ops) {
    const path = String(op.path ?? "");
    if (!path) continue;
    // attach metadata if not present (optional audit use)
    if (!op.ts) op.ts = Date.now();
    if (!op.clientId) op.clientId = clientId;
    setByPath(next, path, op.value);
  }
  return next;
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

// Local run:
// new CollabWSServerV2({ port: 8787 });
