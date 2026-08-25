/**
 * [INPUT]: Depends on ChatStore, BaseStore owner listing, Project archiving narrow queries, search/query flow locator, event loop yield and builtin result
 * [OUTPUT]: Provides Section chat/Base search; Project Base only scans once and carries the ownerKey, the zero-member section ID=null and the archive status is still correct
 * [POS]: The only IO layer in the search domain; Only short read photos are expired but the version is consistent
 */

import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { ownerFromKey } from "../../../shared/bases-ipc";
import { BaseCorruptError, BaseIncarnationError, type BaseStore } from "../bases/base-store";
import { ChatLedgerCorruptError, ChatNotFoundError } from "../chats/chat-commit";
import type { ChatStore } from "../chats/chat-store";
import type { BuiltinToolContext, BuiltinToolset } from "../tools/registry";
import { builtinCallToolResultBytes } from "../tools/result";
import {
  makeSnippet,
  normalize,
  scanBase,
  scanChat,
  tokenize,
  type Checkpoint,
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
  const skipped = { count: 0 };
  const events = sourceEvents(chats, bases, kind, tokens, skipped);
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
      return envelope(hits, skipped.count, false, encodeCursor(kind, queryHash, position));
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
      skipped.count,
      true,
      encodeCursor(kind, queryHash, position + 1)
    );
    if (builtinCallToolResultBytes(candidate) > byteLimit) {
      return envelope(hits, skipped.count, true, encodeCursor(kind, queryHash, position));
    }
    hits.push(hit);
    position += 1;
  }
  return envelope(hits, skipped.count, false);
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
  skipped: { count: number }
): AsyncGenerator<ScanEvent> {
  const shared = { scanned: 0 };
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
      yield* scanBase(
        shared,
        { id: member?.id ?? null, title: member?.title ?? null },
        ownerKey,
        snapshot,
        tokens
      );
      yield { kind: "checkpoint", scanned: shared.scanned };
    }
    return;
  }
  for (const summary of chats.list()) {
    try {
      if (kind === "chat") {
        const record = await chats.get(summary.id);
        if (!record) skipped.count += 1;
        else yield* scanChat(shared, record, tokens);
      }
    } catch (cause) {
      if (isAbort(cause)) throw cause;
      if (isSkippable(cause)) skipped.count += 1;
      else throw cause;
    }
    yield { kind: "checkpoint", scanned: shared.scanned };
  }
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

const isAbort = (cause: unknown) =>
  cause instanceof DOMException && cause.name === "AbortError";

const isSkippable = (cause: unknown) =>
  cause instanceof BaseIncarnationError ||
  cause instanceof BaseCorruptError ||
  cause instanceof ChatLedgerCorruptError ||
  cause instanceof ChatNotFoundError;

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
