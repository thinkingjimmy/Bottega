/**
 * [INPUT]: Depends on immutable Agent authors and the Chat live-view fence
 * [OUTPUT]: Defines bounded handoff and history-reader contracts with independent body and part-manifest truncation
 * [POS]: Shared data only; refs locate evidence and never confer authority
 */

import type { AgentBackendId } from "../agent-ipc";
import type { HandoffCoverage, HistoryViewFence } from "./contracts";
export type { HistoryViewFence } from "./contracts";
export type HistoryRef = Readonly<{
  segment: "native" | "imported";
  messageId: string;
  seq: number;
  digest: string;
  partId?: string;
}>;
export type HistoryCut = Readonly<{ nativeThroughSeq: number; importedThroughSeq: number }>;
export type HistoryBinding = Readonly<{ chatId: string; view: HistoryViewFence; cut: HistoryCut }>;
export type HistoryRecord = Readonly<{
  ref: HistoryRef;
  role: "user" | "assistant";
  backend?: AgentBackendId;
  text: string;
  range: { fromByte: number; toByte: number; totalBytes: number };
  projectionTruncated: boolean;
  projection?: "product-envelopes-removed";
  notSaved: boolean;
  partsTruncated?: boolean;
  parts?: ReadonlyArray<{ partId: string; value: unknown }>;
}>;
export type HistoryPosition = Readonly<{
  mode: "recent" | "search" | "around" | "chunk";
  offset: number;
  query?: string;
  ref?: HistoryRef;
}>;
export type HistoryReadCommand = Readonly<{
  binding: HistoryBinding;
  position: HistoryPosition;
  refresh: boolean;
  byteLimit: number;
}>;
export type HistoryReadResult = {
  status: "ok" | "stale" | "trimmed" | "unavailable" | "notSaved" | "budget-exhausted";
  view: HistoryViewFence;
  viewChanged: boolean;
  storageTrimmed: boolean;
  projectionTruncated: boolean;
  notSaved: boolean;
  records: HistoryRecord[];
  firstReadableRef: HistoryRef | null;
  lastReadableRef: HistoryRef | null;
  hasMore: boolean;
  scanLimited: boolean;
  nextPage: HistoryPosition | null;
  nextChunk: HistoryPosition | null;
  searchScope: string;
};
export type PreparedHistory = {
  binding: HistoryBinding;
  records: HistoryRecord[];
  scannedMessages: number;
  scannedBytes: number;
  storageTrimmed: boolean;
  hasMore: boolean;
};
export type FrozenHandoff = Readonly<{
  binding: HistoryBinding;
  promptVersion: 3;
  promptHash: string;
  text: string;
  coverage: HandoffCoverage;
  refs: readonly HistoryRef[];
}>;
