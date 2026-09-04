/**
 * [INPUT]: Depends on renderer-safe foreign history messages and the closed SQLite history-import entry contract
 * [OUTPUT]: Provides lossless single-path message normalization (folded process statements and their tools ride in the payload and the search text), canonical search text, strict source-order validation, and deterministic bounded batches with >8 MiB blob admission
 * [POS]: Shared normalization seam between source adapters and immutable SQLite generations; it performs no IO
 */

import type { ForeignHistoryMessage } from "../../../../../shared/history-import-ipc";
import { normalizeSearchText } from "../../../../../shared/search-text";
import type { HistoryImportEntryInput } from "../database-protocol";
import {
  IMPORT_BATCH_BYTE_LIMIT,
  IMPORT_BATCH_ENTRY_LIMIT,
  importedEntryDigest,
  importTransactionBytes,
} from "../repository/imports";
import { digest, gramTokens } from "../repository/codec";

/* 折进来的中间陈述与它们的工具一样要能被搜到：折叠改的是渲染形状，
   不是这段历史说过的话。检索面漏掉 process，等于用户明明看得见的一行
   文字搜不出来。 */
function blockSearchText(block: ForeignHistoryMessage) {
  const tools = [
    ...(block.process ?? []).flatMap((step) => step.tools ?? []),
    ...(block.tools ?? []),
  ];
  return [
    ...(block.process ?? []).map((step) => step.text),
    block.content,
    ...tools.flatMap((tool) => [tool.name, tool.input ?? "", tool.output ?? ""]),
  ].join("\n");
}

/* 一条源消息就是一条 entry——只有这一条路。这里曾有第二条路：适配器
   交上来的 unsupported 块被当成 assistant 正文落盘，于是一行原始
   rollout JSON 顶在导入历史最上面。现在非消息记录在适配器就已消失，
   规范化不再需要认识「不是消息的块」。 */
function entryOf(block: ForeignHistoryMessage): HistoryImportEntryInput {
  return {
    sourceEntryId: block.id,
    sourceMessageId: block.id,
    deliverySeq: block.deliverySeq,
    role: block.role,
    content: block.content,
    createdAt: block.createdAt,
    payload: {
      foreignKind: "message",
      nativeTurnId: block.nativeTurnId,
      tools: block.tools ?? [],
      workedForMs: block.workedForMs ?? null,
      ...(block.process?.length ? { process: block.process } : {}),
      ...(block.plan ? { plan: true } : {}),
    },
    searchText: blockSearchText(block),
  };
}

export function normalizeHistoryBlocks(blocks: readonly ForeignHistoryMessage[]) {
  const entries = blocks.map(entryOf);
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index]!.deliverySeq <= entries[index - 1]!.deliverySeq) {
      throw new Error("History source delivery sequence is not strictly increasing");
    }
  }
  return entries;
}

export function prepareHistoryImportEntries(
  entries: readonly HistoryImportEntryInput[]
): HistoryImportEntryInput[] {
  return entries.map((entry) => {
    if (entry.projection?.codecVersion === 1) return entry;
    const normalizedSearchText = normalizeSearchText(entry.searchText);
    const gramsText = gramTokens(normalizedSearchText).join(" ");
    return {
      ...entry,
      projection: {
        codecVersion: 1,
        contentDigest: importedEntryDigest(entry),
        normalizedSearchText,
        searchTextDigest: digest(normalizedSearchText),
        gramsText,
        gramsDigest: digest(gramsText),
      },
    };
  });
}

export function boundedHistoryImportBatches(
  entries: readonly HistoryImportEntryInput[],
  entryLimit = IMPORT_BATCH_ENTRY_LIMIT
) {
  if (!Number.isSafeInteger(entryLimit) || entryLimit < 1 || entryLimit > IMPORT_BATCH_ENTRY_LIMIT) {
    throw new Error("Invalid history import batch entry limit");
  }
  const batches: HistoryImportEntryInput[][] = [];
  let batch: HistoryImportEntryInput[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const entryBytes = importTransactionBytes(entry);
    if (entryBytes > IMPORT_BATCH_BYTE_LIMIT) {
      throw new Error(`History entry ${entry.sourceEntryId} exceeds the transaction budget`);
    }
    if (
      batch.length &&
      (batch.length === entryLimit || bytes + entryBytes > IMPORT_BATCH_BYTE_LIMIT)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(entry);
    bytes += entryBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
