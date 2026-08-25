/**
 * [INPUT]: Depends on shared ForeignHistoryBlock/ForeignHistoryMessage
 * [OUTPUT]: Provides user boundary turn, polymer, stable rendered row key and derivative of DOM anchor
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

export const foreignHistoryAnchor = (key: string) => `foreign-${key}`;
