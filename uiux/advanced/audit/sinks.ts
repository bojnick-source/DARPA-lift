// ==========================================
// AUDIT LOGGING (JSONL + HASH CHAIN) — A34 (HARDENED)
// Audit sinks: in-memory, browser download, node file.
// ==========================================

export interface AuditSink {
  writeLine(line: string): Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export class MemorySink implements AuditSink {
  private lines: string[] = [];
  async writeLine(line: string): Promise<void> {
    this.lines.push(line);
  }
  getText(): string {
    return this.lines.join("\n") + (this.lines.length ? "\n" : "");
  }
}

export class BrowserDownloadSink implements AuditSink {
  private lines: string[] = [];
  private filename: string;

  constructor(filename = `olytheon_audit_${Date.now()}.jsonl`) {
    this.filename = filename;
  }

  async writeLine(line: string): Promise<void> {
    this.lines.push(line);
  }

  async flush(): Promise<void> {
    if (typeof document === "undefined") return;
    const blob = new Blob([this.lines.join("\n") + "\n"], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = this.filename;
    a.click();

    URL.revokeObjectURL(url);
    this.lines = [];
  }
}

export class NodeFileSink implements AuditSink {
  private path: string;
  private fs: any;

  constructor(path: string) {
    this.path = path;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.fs = require("fs");
  }

  async writeLine(line: string): Promise<void> {
    await this.fs.promises.appendFile(this.path, line + "\n", "utf8");
  }
}
