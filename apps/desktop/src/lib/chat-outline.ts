/**
 * [INPUT]: Depends on shared ChatMessage, content generation, foreign history blocks, and canonical foreign row grouping
 * [OUTPUT]: Provides merged product/foreign outline entries and O(log U) active-index lookup
 * [POS]: Pure outline projection shared by ChatOutline and transcript navigation
 */

import { isFailedAssistant } from "../../shared/chat-failure";
import type { ChatMessage } from "../../shared/chats-ipc";
import type { ForeignHistoryBlock } from "../../shared/history-import-ipc";
import {
  foreignHistoryAnchor,
  groupForeignHistoryBlocks,
} from "../../shared/foreign-history-grouping";

export type OutlineEntry = {
  id: string;
  text: string;
  replyExcerpt?: string;
  attachments: string[];
};

export function outlineEntries(messages: ChatMessage[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    let replyExcerpt: string | undefined;
    for (let next = index + 1; next < messages.length; next += 1) {
      const candidate = messages[next];
      if (candidate.role === "user") break;
      if (
        candidate.role === "assistant" &&
        !isFailedAssistant(candidate) &&
        candidate.content.trim()
      ) {
        // 保留全文，展示层按两行 line-clamp 收敛（对齐参考产品 hover 卡）
        replyExcerpt = candidate.content.trim();
        break;
      }
    }
    entries.push({
      id: message.id,
      text: message.content,
      ...(replyExcerpt ? { replyExcerpt } : {}),
      attachments: (message.attachments ?? []).map((item) => item.filename),
    });
  }
  return entries;
}

export function foreignOutlineEntries(
  blocks: readonly ForeignHistoryBlock[],
  contentGenerationKey: string
): OutlineEntry[] {
  const rows = groupForeignHistoryBlocks(blocks);
  return rows.flatMap((row, index) => {
    if (row.kind !== "user") return [];
    const reply = rows[index + 1];
    return [{
      id: foreignHistoryAnchor(contentGenerationKey, row.key),
      text: row.block.content,
      ...(reply?.kind === "turn" && reply.final.content.trim()
        ? { replyExcerpt: reply.final.content.trim() }
        : {}),
      attachments: [],
    }];
  });
}

/**
 * 活跃条目 = 「视口顶部 + 1/3 视口高」之上最近一条 user 消息锚点（决策 13）。
 * 滚动到底时钳制为最后一条：尾部消息的锚点可能永远够不到判定线。
 */
export function activeOutlineIndex(
  anchorTops: number[],
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number
): number {
  if (anchorTops.length === 0) return -1;
  if (scrollTop + viewportHeight >= scrollHeight - 4) return anchorTops.length - 1;
  const reference = scrollTop + viewportHeight / 3;
  let lower = 0;
  let upper = anchorTops.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (anchorTops[middle]! <= reference) lower = middle + 1;
    else upper = middle;
  }
  return Math.max(0, lower - 1);
}
