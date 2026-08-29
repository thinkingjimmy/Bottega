/**
 * [INPUT]: Depends on shared ForeignHistoryBlock/ForeignHistoryMessage
 * [OUTPUT]: Provides user-boundary rows plus canonical content-generation-scoped DOM anchors
 * [POS]: The source of the shared external source transcript identity; main Search locator and renderer line nodes cannot be used to calculate a set of keys
 */

import type {
  ForeignHistoryBlock,
  ForeignHistoryMessage,
} from "./history-import-ipc";

export type ForeignHistoryRow =
  | { kind: "user"; key: string; block: ForeignHistoryMessage }
  | {
      kind: "turn";
      key: string;
      final: ForeignHistoryMessage;
      messages: ForeignHistoryMessage[];
    };

const isMessage = (
  block: ForeignHistoryBlock
): block is ForeignHistoryMessage => block.kind === "message";

export function groupForeignHistoryBlocks(
  blocks: readonly ForeignHistoryBlock[]
): ForeignHistoryRow[] {
  const rows: ForeignHistoryRow[] = [];
  let pending: ForeignHistoryMessage[] = [];
  const flush = () => {
    if (!pending.length) return;
    const messages = pending;
    const final = messages.at(-1)!;
    rows.push({
      kind: "turn",
      key: `${final.id}:${final.deliverySeq}`,
      final,
      messages,
    });
    pending = [];
  };
  for (const block of blocks.filter(isMessage)) {
    if (block.role === "user") {
      flush();
      rows.push({
        kind: "user",
        key: `${block.id}:${block.deliverySeq}`,
        block,
      });
    } else {
      pending.push(block);
    }
  }
  flush();
  return rows;
}

/**
 * 外源 rowKey 只在一份解析结果里唯一；跨 revision/snapshot 复用它会让旧深链
 * 命中新内容。把内容代际焊进 DOM 身份后，Transcript/Find/Outline/Plan 只能指向
 * 同一份 canonical bytes。
 */
export const foreignHistoryAnchor = (
  contentGenerationKey: string,
  rowKey: string
) => `foreign:${contentGenerationKey}:${rowKey}`;
