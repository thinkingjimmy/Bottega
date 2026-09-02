/**
 * [INPUT]: Depends on ChatStore, BaseStore owner listing, Project archiving narrow queries, search/query flow locator, event loop yield and builtin result
 * [OUTPUT]: Provides Section chat/Base search over keyset Chat-document pages; a Project Base is scanned once and carries its ownerKey, a zero-member Section keeps id=null with its archive state intact, and hits whose Chat was rewritten or removed count as skipped_sections instead of failing the call
 * [POS]: The only IO layer in the search domain; Only short read photos are expired but the version is consistent
 */

import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { baseNavigationOf, ownerFromKey } from "../../../shared/bases-ipc";
import {
  appearsInSearchBase,
  searchDestination,
} from "../../../shared/placement/search";
import type { BaseStore } from "../bases/base-store";
import type { ChatStore } from "../chats/chat-store";
import type {
  SearchDocumentCursor,
  SearchDocumentHit,
} from "../chats/sqlite/database-protocol";
import type { BuiltinToolContext, BuiltinToolset } from "../tools/registry";
import { builtinCallToolResultBytes } from "../tools/result";
import {
  makeSnippet,
  matchTokens,
  normalize,
  scanBase,
  tokenize,
  type Checkpoint,
  type ScanCounter,
  type ScanEvent,
  type SearchLocator,
} from "./query";

const SEARCH_RESULT_BYTE_LIMIT = 256 * 1024;
const SEARCH_ENVELOPE_RESERVE = 4 * 1024;
type SearchKind = "chat" | "base";
type SearchArgs = { query: string; cursor?: string; limit: number };

export function createSearchToolset(
  chats: ChatStore,
  bases: BaseStore,
  isEffectiveArchived: (chatId: string) => boolean = () => false,
  isProjectArchived: (projectId: string) => boolean = () => false
): BuiltinToolset {
  return {
    search_chat_history: (args, context) =>
      search(
        chats,
        bases,
        "chat",
        args as SearchArgs,
        context,
        isEffectiveArchived,
        isProjectArchived
      ),
    search_bases: (args, context) =>
      search(
        chats,
        bases,
        "base",
        args as SearchArgs,
        context,
        isEffectiveArchived,
        isProjectArchived
      ),
  };
}

async function search(
  chats: ChatStore,
  bases: BaseStore,
  kind: SearchKind,
  args: SearchArgs,
  context: BuiltinToolContext,
  isEffectiveArchived: (chatId: string) => boolean,
  isProjectArchived: (projectId: string) => boolean
) {
  context.signal.throwIfAborted();
  const tokens = tokenize(args.query);
  const queryHash = hash(normalize(args.query));
  const offset = decodeCursor(args.cursor, kind, queryHash);
  const counter: ScanCounter = { scanned: 0, skipped: 0 };
  const events = sourceEvents(chats, bases, kind, tokens, counter);
  const hits: Array<Record<string, unknown>> = [];
  const byteLimit = Math.min(
    SEARCH_RESULT_BYTE_LIMIT,
    context.lease.resultByteBudget - SEARCH_ENVELOPE_RESERVE
  );
  let position = 0;
  for await (const event of events) {
    if (event.kind === "checkpoint") {
      await checkpoint(context, event);
      continue;
    }
    if (position < offset) {
      position += 1;
      continue;
    }
    if (hits.length >= args.limit) {
      return envelope(hits, counter.skipped, false, encodeCursor(kind, queryHash, position));
    }
    const hit = {
      ...toHit(event),
      effective_archived: effectiveArchived(
        event,
        isEffectiveArchived,
        isProjectArchived
      ),
    };
    const next = [...hits, hit];
    const candidate = envelope(
      next,
      counter.skipped,
      true,
      encodeCursor(kind, queryHash, position + 1)
    );
    if (builtinCallToolResultBytes(candidate) > byteLimit) {
      return envelope(hits, counter.skipped, true, encodeCursor(kind, queryHash, position));
    }
    hits.push(hit);
    position += 1;
  }
  return envelope(hits, counter.skipped, false);
}

function effectiveArchived(
  event: SearchLocator,
  isEffectiveArchived: (chatId: string) => boolean,
  isProjectArchived: (projectId: string) => boolean
) {
  if (event.sectionId !== null) return isEffectiveArchived(event.sectionId);
  if (event.source !== "base") return false;
  const owner = ownerFromKey(event.ownerKey);
  return owner.kind === "project" && isProjectArchived(owner.projectId);
}

async function* sourceEvents(
  chats: ChatStore,
  bases: BaseStore,
  kind: SearchKind,
  tokens: readonly string[],
  counter: ScanCounter
): AsyncGenerator<ScanEvent> {
  if (kind === "base") {
    const summaries = chats.list();
    for (const { ownerKey, snapshot } of bases.listAll()) {
      const owner = snapshot.meta.owner;
      const member =
        owner.kind === "chat"
          ? summaries.find((summary) => summary.id === owner.chatId)
          : summaries
              .filter((summary) => summary.projectId === owner.projectId)
              .sort(
                (left, right) =>
                  right.updatedAt - left.updatedAt ||
                  left.id.localeCompare(right.id)
              )[0];
      if (!appearsInSearchBase(
        baseNavigationOf(snapshot.meta),
        owner.kind !== "chat" || Boolean(member && searchDestination(member))
      )) continue;
      yield* scanBase(
        counter,
        { id: member?.id ?? null, title: member?.title ?? null },
        ownerKey,
        snapshot,
        tokens
      );
      yield { kind: "checkpoint", scanned: counter.scanned };
    }
    return;
  }
  yield* sqliteChatEvents(chats, tokens, counter);
}

async function* sqliteChatEvents(
  chats: ChatStore,
  tokens: readonly string[],
  counter: ScanCounter
): AsyncGenerator<ScanEvent> {
  const summaries = new Map(chats.list().map((summary) => [summary.id, summary]));
  let cursor: SearchDocumentCursor | null = null;
  while (true) {
    const page = await chats.searchTimelineDocuments(tokens, cursor, 500);
    if (!page) return;
    for (const hit of page.hits) {
      counter.scanned += 1;
      if (counter.scanned % 500 === 0) {
        yield { kind: "checkpoint", scanned: counter.scanned };
      }
      /* 命中所属 Chat 被删或已改写：这条候选只是过期，不是工具调用失败。
         跳过并计入 skipped_sections，一次无关写入不该炸掉整次搜索。 */
      const summary = summaries.get(hit.chatId);
      if (!summary || !sameSearchFence(summary, hit)) {
        counter.skipped += 1;
        continue;
      }
      if (!searchDestination(summary)) continue;
      /* offset 0 是合法命中：标题几乎总在 0 处命中，用真值判断会整类丢失。 */
      if (matchTokens(hit.searchText, tokens) === null) continue;
      const normalizedText = normalize(hit.searchText);
      const offsets = tokens
        .map((token) => normalizedText.indexOf(normalize(token)))
        .filter((value) => value >= 0);
      const common = {
        kind: "locator" as const,
        source: "chat" as const,
        sectionId: hit.chatId,
        title: hit.title,
        agent: hit.agent,
        updatedAt: hit.updatedAt,
        normalizedText,
        offset: offsets.length ? Math.min(...offsets) : 0,
      };
      yield hit.documentKind === "title"
        ? { ...common, matched: "title" }
        : {
            ...common,
            matched: "message",
            messageSeq: hit.messageSeq ?? hit.message?.seq ?? 0,
            role: (hit.messageRole ?? hit.message?.role) === "user"
              ? "user"
              : "assistant",
          };
    }
    if (page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}

function sameSearchFence(
  summary: ReturnType<ChatStore["list"]>[number],
  hit: SearchDocumentHit
) {
  return summary.chatRecordRevision === hit.coreRevision &&
    summary.chatMessageRevision === hit.nativeMessageRevision;
}

async function checkpoint(context: BuiltinToolContext, _event: Checkpoint) {
  await yieldToEventLoop();
  context.signal.throwIfAborted();
}

function toHit(locator: SearchLocator): Record<string, unknown> {
  const snippet = makeSnippet(locator.normalizedText, locator.offset);
  if (locator.source === "chat") {
    const common = {
      section_id: locator.sectionId,
      title: locator.title,
      agent: locator.agent,
      updated_at: locator.updatedAt,
      matched: locator.matched,
      snippet,
    };
    return locator.matched === "message"
      ? { ...common, message_seq: locator.messageSeq, role: locator.role }
      : common;
  }
  const common = {
    section_id: locator.sectionId,
    owner_key: locator.ownerKey,
    chat_title: locator.chatTitle,
    base_name: locator.baseName,
    matched: locator.matched,
    snippet,
  };
  if (locator.matched === "column") return { ...common, column_id: locator.columnId };
  if (locator.matched === "cell") {
    return { ...common, row_id: locator.rowId, column_id: locator.columnId };
  }
  return common;
}

function envelope(
  hits: Array<Record<string, unknown>>,
  skippedSections: number,
  truncatedByBytes: boolean,
  nextCursor?: string
) {
  return {
    hits,
    truncatedByBytes,
    skipped_sections: skippedSections,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function encodeCursor(kind: SearchKind, queryHash: string, offset: number) {
  return Buffer.from(JSON.stringify({ v: 1, kind, queryHash, offset })).toString(
    "base64url"
  );
}

function decodeCursor(value: string | undefined, kind: SearchKind, queryHash: string) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      v?: unknown;
      kind?: unknown;
      queryHash?: unknown;
      offset?: unknown;
    };
    if (
      parsed.v !== 1 ||
      parsed.kind !== kind ||
      parsed.queryHash !== queryHash ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset as number) < 0
    ) {
      throw new Error("cursor mismatch");
    }
    return parsed.offset as number;
  } catch {
    throw statusError(400, "搜索 cursor 与当前工具或 query 不匹配");
  }
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url").slice(0, 16);

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
