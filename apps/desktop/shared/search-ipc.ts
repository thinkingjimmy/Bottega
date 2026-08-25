/**
 * [INPUT]: Depends on external source history source type; The rest use only the sequentially based type
 * [OUTPUT]: Provides SearchJob start/pull/cancel Chat/History live goals, stable hits, snapshot revision, skip session disclosure and cursor IPC agreement
 * [POS]: The truth source of the shared universal search wire; The only back-up capability of the renderer is the pull credit/byte budget
 */

import type { HistorySourceKind } from "./history-import-ipc";

export type GlobalSearchSource = "chat" | "base" | "history";

export type GlobalSearchTarget =
  | { kind: "chat-message"; messageId: string }
  | { kind: "history-block"; offset: string };

export type GlobalSearchHit = Readonly<{
  key: string;
  source: GlobalSearchSource;
  title: string;
  subtitle: string;
  snippet: string;
  route: string;
  updatedAt: number;
  matched: string;
  target?: GlobalSearchTarget;
  sourceKind?: HistorySourceKind;
}>;

export type StartSearchInput = Readonly<{ query: string }>;
export type SearchJobStarted = Readonly<{
  jobId: string;
  snapshotRevision: string;
  cursor: string;
}>;
export type PullSearchInput = Readonly<{
  jobId: string;
  cursor: string;
  credit: number;
  byteBudget: number;
}>;
export type SearchJobPage = Readonly<{
  hits: GlobalSearchHit[];
  nextCursor: string | null;
  done: boolean;
  scanned: number;
  skipped: number;
  skippedSessions?: number;
  snapshotRevision: string;
}>;

export const SEARCH_JOB_CHANNEL = {
  start: "search-job:start",
  pull: "search-job:pull",
  cancel: "search-job:cancel",
} as const;

export type SearchJobBridgeApi = {
  start(input: StartSearchInput): Promise<SearchJobStarted>;
  pull(input: PullSearchInput): Promise<SearchJobPage>;
  cancel(jobId: string): Promise<void>;
};
