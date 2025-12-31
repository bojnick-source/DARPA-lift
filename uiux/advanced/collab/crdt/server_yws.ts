// ==========================================
// CRDT UPGRADE (Yjs) — A27 (HARDENED)
// Minimal Node server using y-websocket utilities.
// Adds:
//  - token check placeholder
//  - message size cap
// ==========================================

import http from "http";
import WebSocket from "ws";
import { setupWSConnection } from "y-websocket/bin/utils.js";

export interface YWSServerOptions {
  port: number;
  maxPayloadBytes?: number; // default 1MB
  // Optional auth token validator
  validateToken?: (token: string | null) => boolean;
}

export function startYWSServer(opts: YWSServerOptions) {
  const maxPayload = opts.maxPayloadBytes ?? 1_000_000;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("yws ok\n");
  });

  const wss = new WebSocket.Server({ server, maxPayload });

  wss.on("connection", (conn, req) => {
    // token gate (optional)
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    if (opts.validateToken && !opts.validateToken(token)) {
      try { conn.close(1008, "unauthorized"); } catch {}
      return;
    }

    setupWSConnection(conn as any, req as any, { gc: true });
  });

  server.listen(opts.port);
  return { server, wss };
}

// Usage:
// startYWSServer({ port: 8787, validateToken: (t) => t === process.env.COLLAB_TOKEN });
