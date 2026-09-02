/**
 * [INPUT]: Depends on the Agent backend identity and the shared product-destination facts
 * [OUTPUT]: Provides the SearchJob start/pull/cancel contract over the Chat and Base lanes: source-specific identity, stable hits, scanned/skipped counters, snapshot revision, and cursor
 * [POS]: The single source of truth for the shared global-search wire; the renderer's only backpressure lever is the pull credit/byte budget
 */

import type { AgentBackendId } from "./agent-ipc";
import type { ProductDestination } from "./placement/facts";

/* 外源历史不再有自己的搜索泳道：同步后它就是一条只读 canonical Chat，
   命中经 chat 泳道给出，命中目标也只剩产品消息一种。 */
export type GlobalSearchSource = "chat" | "base";

export type GlobalSearchTarget = { kind: "chat-message"; messageId: string };

export type GlobalSearchHit = Readonly<{
  key: string;
  title: string;
  subtitle: string;
  snippet: string;
  route: string;
  destination: ProductDestination;
  updatedAt: number;
  matched: string;
  target?: GlobalSearchTarget;
} & ({ source: "chat"; agent: AgentBackendId } | { source: "base" })>;

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
