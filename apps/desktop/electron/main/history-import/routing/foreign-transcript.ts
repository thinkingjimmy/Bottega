/**
 * [INPUT]: Depends on shared external-history messages (read through foreignMessageText so folded statements survive) and the Section export byte budget
 * [OUTPUT]: Provides a recent-first bounded plain-text snapshot for references
 * [POS]: Pure external transcript projection beneath HistoryImportService
 */

import { SECTION_EXPORT_BYTE_LIMIT } from "../../../../shared/agent-ipc";
import {
  foreignMessageText,
  type ForeignHistoryMessage,
} from "../../../../shared/history-import-ipc";

export function foreignTranscriptSnapshot(title: string, blocks: readonly ForeignHistoryMessage[]) {
  /* 折进末条的中间陈述与它们的工具同属这一轮：摘录不认渲染形状，只认说过的话。 */
  const chunks = blocks.map((block) => [
    `${block.role}: ${foreignMessageText(block)}`,
    ...[
      ...(block.process ?? []).flatMap((step) => step.tools ?? []),
      ...(block.tools ?? []),
    ].map((tool) => `  [tool:${tool.name}]`),
  ].join("\n"));
  const header = `# ${title}\n\n`;
  let bodyChunks = [...chunks];
  let body = bodyChunks.join("\n\n");
  const budget = SECTION_EXPORT_BYTE_LIMIT - Buffer.byteLength(header, "utf8");
  while (bodyChunks.length > 1 && Buffer.byteLength(body, "utf8") > budget) {
    bodyChunks = bodyChunks.slice(1);
    body = `[已按字节预算截断，仅保留最近内容]\n\n${bodyChunks.join("\n\n")}`;
  }
  if (Buffer.byteLength(body, "utf8") > budget) {
    body = Buffer.from(body, "utf8").subarray(0, Math.max(0, budget)).toString("utf8");
  }
  return `${header}${body}`;
}
