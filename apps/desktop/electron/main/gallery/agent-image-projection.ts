/**
 * [INPUT]: Depends on Agent bridge Activities Turn queries, completed image item and main-only Gallery feedback
 * [OUTPUT]: Provides canonical savedPath projection, renderer DTO path clearance and occurrence verification of activity images; Delta was referring to the direct line, and the rest of the pre-zero-sum distribution detection and target image was reconstructed
 * [POS]: The gallery's Agent is on the line; canonical ChatStore keeps the retargeting detail and removes it from all renderer output unified
 */

import type { AgentTurnItem } from "../../../shared/agent-ipc";
import type {
  AgentBridgeOptions,
  BridgeEntry,
} from "../agent/bridge-types";

export type ActiveImageSourceRef = {
  chatId: string;
  assistantSeq: number;
  itemId: string;
};

export async function projectAgentImage(input: {
  entry: BridgeEntry;
  item: AgentTurnItem;
  options: AgentBridgeOptions;
  workspaceRoot: string;
}) {
  const { entry, item, options, workspaceRoot } = input;
  if (item.kind === "image" && item.status === "completed" && item.detail) {
    const imageParts = entry.draft.parts.filter(
      (part) => part.type === "tool" && part.tool === "image"
    );
    const current = imageParts.findIndex((part) => part.itemId === item.itemId);
    try {
      await options.onCompletedImage?.({
        conversationId: entry.conversationId,
        messageId: entry.messageId,
        assistantSeq: entry.assistantSeq,
        itemOrdinal: current >= 0 ? current : imageParts.length,
        item,
        workspaceRoot,
      });
    } catch (cause) {
      console.warn("[gallery] completed image unavailable", cause);
    }
  }
  return item;
}

function isTextDelta(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "item-delta" || type === "subagent-item-delta";
}

function containsImageDetail(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsImageDetail);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    (record.kind === "image" || record.tool === "image") &&
    Object.hasOwn(record, "detail")
  ) {
    return true;
  }
  return Object.values(record).some(containsImageDetail);
}

function projectWithoutImageDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectWithoutImageDetails);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const projected = Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      projectWithoutImageDetails(child),
    ])
  );
  if (record.kind === "image" || record.tool === "image") {
    delete projected.detail;
  }
  return projected;
}

export function redactImageDetails<T>(value: T): T {
  // 文本 delta 的 wire 形状不携带 item；这是最高频路径，直接保留引用。
  if (isTextDelta(value) || !containsImageDetail(value)) return value;
  return projectWithoutImageDetails(value) as T;
}

export function isActiveImageOccurrence(
  lookup: (chatId: string) => BridgeEntry | undefined,
  sourceRef: ActiveImageSourceRef
) {
  const entry = lookup(sourceRef.chatId);
  if (!entry || entry.assistantSeq !== sourceRef.assistantSeq) return false;
  return entry.draft.parts.some(
    (part) =>
      part.type === "tool" &&
      part.tool === "image" &&
      part.itemId === sourceRef.itemId
  );
}
