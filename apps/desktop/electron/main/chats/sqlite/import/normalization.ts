/**
 * [INPUT]: Depends on renderer-safe foreign history blocks and the closed SQLite history-import entry contract
 * [OUTPUT]: Provides lossless block normalization, canonical search text, strict source-order validation, and deterministic bounded batches with >8 MiB blob admission
 * [POS]: Shared normalization seam between source adapters and immutable SQLite generations; it performs no IO
 */

import type { ForeignHistoryBlock } from "../../../../../shared/history-import-ipc";
import { normalizeSearchText } from "../../../../../shared/search-text";
import type { HistoryImportEntryInput } from "../database-protocol";
import {
  IMPORT_BATCH_BYTE_LIMIT,
  IMPORT_BATCH_ENTRY_LIMIT,
  importedEntryDigest,
  importTransactionBytes,
} from "../repository/imports";
import { digest, gramTokens } from "../repository/codec";

function blockSearchText(block: ForeignHistoryBlock) {
  if (block.kind === "unsupported") {
    return `${block.reason}\n${block.escapedPreview}`;
  }
  return [
    block.content,
    ...(block.tools ?? []).flatMap((tool) => [tool.name, tool.input ?? "", tool.output ?? ""]),
  ].join("\n");
}

function entryOf(block: ForeignHistoryBlock): HistoryImportEntryInput {
  if (block.kind === "unsupported") {
    return {
      sourceEntryId: block.id,
      sourceMessageId: null,
      deliverySeq: block.deliverySeq,
      role: "assistant",
      content: block.escapedPreview,
      createdAt: block.createdAt,
      payload: { foreignKind: "unsupported", reason: block.reason },
      contentComplete: false,
      incompleteReason: block.reason,
      searchText: blockSearchText(block),
    };
  }
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
    },
    contentComplete: true,
    incompleteReason: null,
    searchText: blockSearchText(block),
  };
}

export function normalizeHistoryBlocks(blocks: readonly ForeignHistoryBlock[]) {
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
