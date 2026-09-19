/**
 * [INPUT]: Depends on shared individual/packed activity decoding, verified imported descriptors and the original bounded saved-part reader.
 * [OUTPUT]: Projects cached tool/process fields for the native timeline without copying full fields into payload JSON.
 * [POS]: Imported display adapter; full saved fields remain independently readable through Chat history.
 */
import { decodeImportedActivityField } from "@ai-chat/cloud-protocol/chats/imported/projection";
import { completionMetadataSchema } from "../../../../../../shared/local-storage/contracts";
import type { ForeignProcessStep, ForeignToolEvent } from "../../../../../../shared/history-import-ipc";
import type { SqliteDatabase } from "../../connection";
import { readHistoryParts } from "../../history/parts";
import { parseJson } from "../../repository/codec";
export function importedProjectionPayload(db: SqliteDatabase, id: string, raw: unknown) {
  const payload = parseJson(raw, "imported payload") as Record<string, unknown>;
  if (!payload.cloudReady) return payload;
  const tools: ForeignToolEvent[] = [], process: ForeignProcessStep[] = [];
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const tool = (value: unknown, key: string): ForeignToolEvent | null => {
    const item = object(value); if (typeof item.name !== "string") return null;
    return { id: key, name: item.name, ...completionMetadataSchema.parse(item),
      ...(typeof item.input === "string" ? { input: item.input } : {}), ...(typeof item.output === "string" ? { output: item.output } : {}) };
  };
  for (const { partId, value } of readHistoryParts(db, id).parts.sort((a, b) => a.partId.localeCompare(b.partId, "en", { numeric: true }))) {
    if (object(value).projectionTruncated === true) continue;
    const activity = decodeImportedActivityField(partId, value);
    for (const [index, value] of (activity?.tools ?? []).entries()) {
      const item = tool(value, `${id}:${partId}:${index}`); if (item) tools.push(item);
    }
    for (const [step, item] of (activity?.process ?? []).entries()) {
      process.push({ text: item.text, tools: (item.tools ?? []).flatMap((value, index) => {
        const saved = tool(value, `${id}:${partId}:${step}:${index}`); return saved ? [saved] : [];
      }) });
    }
  }
  return { ...payload, tools, process };
}
