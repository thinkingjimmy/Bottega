/**
 * [INPUT]: Depends on the adapter entry/scan-depth, history source kind and prepared SQLite history-import entry contracts
 * [OUTPUT]: Provides the closed import-worker vocabulary: the streaming parse request, the answered call (scan, warm-up, complete parse), the source roots, acknowledgement, cancellation, prepared batch, completion, answer and coded failure
 * [POS]: Trust boundary between Electron main and the read-only external-history worker, the only thread that reads another Agent's files
 */

import type { HistorySourceKind } from "../../../../shared/ipc/content/history-import-ipc";
import type { HistoryImportEntryInput } from "../../chats/sqlite/database-protocol";
import type { AdapterEntry, ScanDepth } from "../adapters/adapter";

/** Each source's state root, resolved in main from the fence table (sources.ts); the worker reads only under these. */
export type HistorySourceRoots = Readonly<Record<HistorySourceKind, string>>;

export type ImportWorkerRequest = Readonly<{
  version: 1;
  kind: "parse";
  requestId: string;
  roots: HistorySourceRoots;
  entry: AdapterEntry;
}>;

/* One answered request on the worker (TASK-11 D10): a scan, a warm-up or a complete parse, so main's thread never reads a source. They
   run beside a streaming parse, not behind it: a scan is what the person waits for when a folder is picked. */
export type ImportWorkerCallBody = Readonly<{ roots: HistorySourceRoots; sourceKind: HistorySourceKind }> & (
  | Readonly<{ op: "scan"; root: string; depth?: ScanDepth }>
  | Readonly<{ op: "warm" }>
  | Readonly<{ op: "parse"; entry: AdapterEntry }>
);
export type ImportWorkerCall = Readonly<{ version: 1; kind: "call"; requestId: string }> & ImportWorkerCallBody;

export type ImportWorkerAck = Readonly<{
  version: 1;
  kind: "ack";
  requestId: string;
  batchIndex: number;
}>;

/* 放弃一条解析：main 不再终止线程，于是必须有一句话让 worker 从 ack
   等待里立刻脱身，否则下一条请求要陪它等满 60 秒。 */
export type ImportWorkerCancel = Readonly<{
  version: 1;
  kind: "cancel";
  requestId: string;
}>;

export type ImportWorkerResponse =
  | Readonly<{
      version: 1;
      kind: "batch";
      requestId: string;
      batchIndex: number;
      entries: HistoryImportEntryInput[];
    }>
  | Readonly<{
      version: 1;
      kind: "done";
      requestId: string;
      incompleteTail: boolean;
    }>
  | Readonly<{
      version: 1;
      kind: "answer";
      requestId: string;
      value: unknown;
    }>
  | Readonly<{
      version: 1;
      kind: "failure";
      requestId: string;
      message: string;
      /** The adapter's coded error (HISTORY_REVISION_CHANGED), carried so main sees the same error it would have thrown itself. */
      code?: string;
    }>;

export function parseImportWorkerResponse(
  value: unknown,
  requestId: string
): ImportWorkerResponse {
  if (!value || typeof value !== "object") throw new Error("Import worker response is invalid");
  const response = value as Partial<ImportWorkerResponse>;
  if (
    response.version !== 1 ||
    response.requestId !== requestId ||
    !["batch", "done", "answer", "failure"].includes(String(response.kind))
  ) {
    throw new Error("Import worker response envelope mismatch");
  }
  if (response.kind === "batch") {
    if (!Number.isSafeInteger(response.batchIndex) || !Array.isArray(response.entries)) {
      throw new Error("Import worker batch is invalid");
    }
  } else if (response.kind === "failure" && typeof response.message !== "string") {
    throw new Error("Import worker failure is invalid");
  }
  return response as ImportWorkerResponse;
}
