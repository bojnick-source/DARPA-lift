// ==========================================
// DETERMINISTIC REPLAY — A35 (HARDENED)
// Node CLI: verify hash chain + replay + print final hash.
// Usage: node cli.js /path/to/audit.jsonl
// ==========================================

import fs from "fs";
import { parseJsonl } from "./jsonl";
import { verifyHashChain } from "./hash_chain_verify";
import { replayAuditLog } from "./replay_engine";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node cli.js /path/to/audit.jsonl");
    process.exit(2);
  }

  const text = fs.readFileSync(path, "utf8");
  const events = parseJsonl(text);

  const hc = await verifyHashChain(events);
  if (!hc.ok) {
    console.error(`Hash chain FAILED at index ${hc.firstBadIndex}: ${hc.reason}`);
    process.exit(1);
  }

  const { metrics } = await replayAuditLog(events, {
    allowedPrefixes: ["ui.", "opt.", "mc.", "gates.", "morph.", "routing.", "mjcf."],
  });

  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
