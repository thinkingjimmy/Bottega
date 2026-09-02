/**
 * [INPUT]: Depends on the adapter entry and prepared SQLite history-import entry contracts
 * [OUTPUT]: Provides the closed import-worker request, acknowledgement, cancellation, prepared batch, completion, and failure vocabulary
 * [POS]: Trust boundary between Electron main and the read-only external-history parser worker
 */

import type { HistoryImportEntryInput } from "../../chats/sqlite/database-protocol";
import type { AdapterEntry } from "../adapter";

export type ImportWorkerRequest = Readonly<{
  version: 1;
  kind: "parse";
  requestId: string;
  home: string;
  entry: AdapterEntry;
}>;

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
      kind: "failure";
      requestId: string;
      message: string;
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
    !["batch", "done", "failure"].includes(String(response.kind))
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
