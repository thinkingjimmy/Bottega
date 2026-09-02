/**
 * [INPUT]: Depends on shared baseCellText/cellValue/ownerKey/search-text and a read-only Base snapshot
 * [OUTPUT]: Provides owner-aware (zero-member sectionId=null) Base locator scan plus the Chat locator types the SQLite candidate lanes project into
 * [POS]: The search domain has no IO-only query kernel; The toolset holds cross-Sectional scanning counts and asynchronous deletion of rhythm
 */

import { baseCellText } from "../../../shared/base-values";
import {
  cellValue,
  createBaseCellContext,
} from "../../../shared/base-cell-value";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type { ReadonlyBaseSnapshot } from "../bases/base-store";
import {
  matchSearchTokens as matchTokens,
  makeSearchSnippet as makeSnippet,
  normalizedSearchMatch,
  normalizeSearchText as normalize,
  tokenizeSearchQuery as tokenize,
} from "../../../shared/search-text";

export { makeSnippet, matchTokens, normalize, tokenize };

/* skipped 与 scanned 同源记账：命中所属 Chat 已被改写或删除时，那条候选
   不是错误而是过期，跳过并计数，整个 job 不为一次无关写入而中止。 */
export type ScanCounter = { scanned: number; skipped: number };
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

export type SearchLocator = ChatLocator | BaseLocator;
export type ScanEvent = SearchLocator | Checkpoint;

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

function normalizedMatch(value: string, tokens: readonly string[]) {
  return normalizedSearchMatch(value, tokens);
}
