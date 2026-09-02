/**
 * [INPUT]: Depends on shared ChatMessage and canonical failure classification
 * [OUTPUT]: Provides loaded-message outline entries, the transcript-ordered minimap merge of loaded and canonical windows, and O(log U) active-index lookup
 * [POS]: Pure outline projection shared by ChatOutline and transcript navigation
 */

import { isFailedAssistant } from "../../shared/chat-failure";
import type { ChatMessage, ChatOutlineItem } from "../../shared/chats-ipc";

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

/* ── 两串有序序列合成一条小地图 ───────────────────────────────────
 * canonical 窗口只留最新的一段，已加载消息可能比它更早：把落选的那批
 * 直接追加到末尾，小地图的顺序就与转录反了，而 activeOutlineIndex 的前提
 * 恰恰是「tops 单调递增」——高亮于是跳到别处。
 * 两串各自有序，用「首个共同条目」当对齐点即可：它之前的已加载条目排在
 * canonical 之前，之后的排在它之后。没有共同条目时 canonical 更旧，整串
 * 已加载条目跟在后面。
 * ────────────────────────────────────────────────────────── */
export function outlineMinimapEntries(
  messages: ChatMessage[],
  canonicalItems: readonly ChatOutlineItem[] = []
): OutlineEntry[] {
  const loaded = outlineEntries(messages);
  const loadedById = new Map(loaded.map((entry) => [entry.id, entry]));
  const canonical = canonicalItems
    .filter((item) => item.role === "user")
    .map((item) =>
      loadedById.get(item.messageId) ?? {
        id: item.messageId,
        text: item.text,
        attachments: [],
      }
    );
  const canonicalIds = new Set(canonical.map((entry) => entry.id));
  const anchor = loaded.findIndex((entry) => canonicalIds.has(entry.id));
  const extra = (from: number, to: number) =>
    loaded.slice(from, to).filter((entry) => !canonicalIds.has(entry.id));
  return anchor < 0
    ? [...canonical, ...loaded]
    : [...extra(0, anchor), ...canonical, ...extra(anchor, loaded.length)];
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
