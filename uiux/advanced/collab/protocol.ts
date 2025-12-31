export type DocId = string;
export type ClientId = string;

export type CollabMsg =
  | { t: "hello"; docId: DocId; lastSeenVersion?: number }
  | { t: "snapshot"; docId: DocId; version: number; state: any }
  | { t: "op"; docId: DocId; baseVersion: number; opId: string; patch: any }
  | { t: "ack"; docId: DocId; opId: string; newVersion: number }
  | { t: "presence"; docId: DocId; clientId: ClientId; cursor?: any; selection?: any }
  | { t: "error"; code: string; message: string };
