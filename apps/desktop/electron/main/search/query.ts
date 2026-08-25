/**
 * [INPUT]: Depends on canonical Section messageLines ((neutral projection of attachments that are not related to the delivery plan) √ shared baseCellText/cellValue/ownerKey/search-text/foreign grouping and read-only Chat/Base/History snapshot
 * [OUTPUT]: Provides owner-aware ((0 member sectionId=null) Chat/Base/History locator scan and checkpoint with formula requests; The full text is unified, AND matches and snippets are unified, shared/search-text is converted
 * [POS]: The search domain has no IO-only query kernel; The toolset holds cross-Sectional scanning counts and asynchronous deletion of rhythm
 */

import { baseCellText } from "../../../shared/base-values";
import {
  cellValue,
  createBaseCellContext,
} from "../../../shared/base-cell-value";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
import type { ReadonlyBaseSnapshot } from "../bases/base-store";
import { messageLines } from "../sections/export-transcript";
import type { ForeignHistoryBlock, HistorySourceKind } from "../../../shared/history-import-ipc";
import { groupForeignHistoryBlocks } from "../../../shared/foreign-history-grouping";
import {
  matchSearchTokens as matchTokens,
  makeSearchSnippet as makeSnippet,
  normalizedSearchMatch,
  normalizeSearchText as normalize,
  tokenizeSearchQuery as tokenize,
} from "../../../shared/search-text";

export { makeSnippet, matchTokens, normalize, tokenize };

export type ScanCounter = { scanned: number };
export type Checkpoint = { kind: "checkpoint"; scanned: number };

type LocatorText = {
  kind: "locator";
  normalizedText: string;
  offset: number;
};

export type ChatLocator = LocatorText & {
  source: "chat";
  sectionId: string;
  title: string | null;
  agent: AgentBackendId;
  updatedAt: number;
} & (
    | { matched: "title" }
    | { matched: "message"; messageSeq: number; role: "user" | "assistant" }
  );

export type BaseLocator = LocatorText & {
  source: "base";
  ownerKey: string;
  sectionId: string | null;
  chatTitle: string | null;
  baseName: string;
} & (
    | { matched: "name" }
    | { matched: "column"; columnId: string }
    | { matched: "cell"; rowId: string; columnId: string }
  );

export type HistoryLocator = LocatorText & {
  source: "history";
  opaqueId: string;
  projectId: string;
  sourceKind: HistorySourceKind;
  title: string;
  updatedAt: number;
  historyRevision: string;
  renderedRowKey: string;
  matched: "title" | "message";
};

export type SearchLocator = ChatLocator | BaseLocator;
export type JobSearchLocator = SearchLocator | HistoryLocator;
export type ScanEvent = SearchLocator | Checkpoint;
export type HistoryScanEvent = HistoryLocator | Checkpoint;

export function* scanChat(
  shared: ScanCounter,
  record: ChatRecord,
  tokens: readonly string[]
): Generator<ScanEvent> {
  const title = normalizedMatch(record.title ?? "", tokens);
  if (title) {
    yield {
      kind: "locator",
      source: "chat",
      sectionId: record.id,
      title: record.title,
      agent: record.agent,
      updatedAt: record.updatedAt,
      matched: "title",
      ...title,
    };
  }
  for (const message of [...record.messages].sort((a, b) => a.seq - b.seq)) {
    shared.scanned += 1;
    if (shared.scanned % 500 === 0) {
      yield { kind: "checkpoint", scanned: shared.scanned };
    }
    if (message.role === "notice") continue;
    /* 搜索语料是给人看的：附件行取与 @Section 交割计划无关的中性投影，
       规划锚点绝不能进 snippet。 */
    const matched = normalizedMatch(
      messageLines(message, "plain").join("\n"),
      tokens
    );
    if (!matched) continue;
    yield {
      kind: "locator",
      source: "chat",
      sectionId: record.id,
      title: record.title,
      agent: record.agent,
      updatedAt: record.updatedAt,
      matched: "message",
      messageSeq: message.seq,
      role: message.role,
      ...matched,
    };
  }
}

export function* scanBase(
  shared: ScanCounter,
  section: { id: string | null; title: string | null },
  ownerKey: string,
  base: ReadonlyBaseSnapshot,
  tokens: readonly string[]
): Generator<ScanEvent> {
  const common = {
    source: "base" as const,
    ownerKey,
    sectionId: section.id,
    chatTitle: section.title,
    baseName: base.meta.name,
  };
  const name = normalizedMatch(base.meta.name, tokens);
  if (name) yield { kind: "locator", ...common, matched: "name", ...name };
  for (const column of base.meta.columns) {
    const matched = normalizedMatch(column.name, tokens);
    if (matched) {
      yield {
        kind: "locator",
        ...common,
        matched: "column",
        columnId: column.id,
        ...matched,
      };
    }
  }
  const context = createBaseCellContext({
    columns: base.meta.columns,
    rows: base.rows,
  });
  for (const row of base.rows) {
    shared.scanned += 1;
    if (shared.scanned % 500 === 0) {
      yield { kind: "checkpoint", scanned: shared.scanned };
    }
    for (const column of base.meta.columns) {
      const matched = normalizedMatch(
        baseCellText(column, cellValue(row, column, context)),
        tokens
      );
      if (!matched) continue;
      yield {
        kind: "locator",
        ...common,
        matched: "cell",
        rowId: row.id,
        columnId: column.id,
        ...matched,
      };
    }
  }
}

export function* scanHistoryBlocks(
  shared: ScanCounter,
  entry: {
    opaqueId: string;
    projectId: string;
    sourceKind: HistorySourceKind;
    title: string;
    updatedAt: number;
    historyRevision: string;
  },
  blocks: readonly ForeignHistoryBlock[],
  tokens: readonly string[]
): Generator<HistoryScanEvent> {
  const title = normalizedSearchMatch(entry.title, tokens);
  if (title) {
    yield {
      kind: "locator",
      source: "history",
      ...entry,
      renderedRowKey: "title",
      matched: "title",
      ...title,
    };
  }
  for (const row of groupForeignHistoryBlocks(blocks)) {
    shared.scanned += 1;
    if (shared.scanned % 500 === 0) yield { kind: "checkpoint", scanned: shared.scanned };
    const text = row.kind === "user"
      ? row.block.content
      : row.messages.map((message) => message.content).join("\n");
    const matched = normalizedSearchMatch(text, tokens);
    if (!matched) continue;
    yield {
      kind: "locator",
      source: "history",
      ...entry,
      renderedRowKey: row.key,
      matched: "message",
      ...matched,
    };
  }
}

function normalizedMatch(value: string, tokens: readonly string[]) {
  return normalizedSearchMatch(value, tokens);
}
