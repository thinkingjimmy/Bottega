/**
 * [INPUT]: Depends on shared/chats-ipc and the shared/chat-turn-reducer's DraftPart/DraftToolPart
 * [OUTPUT]: Provides groupParts (GroupedToolPart and groupSummary)
 * [POS]: The turn rendering projection of lib is pure function: reducer pipe flow state, where only the grouping is shown and can be returned independently
 */

import type { ChatTextPart } from "../../shared/chats-ipc";
import type {
  DraftPart,
  DraftSubagentPart,
  DraftToolPart,
} from "../../shared/chat-turn-reducer";

/** 渲染层消费的工具行：merged 标记该 reasoning 由连续多条合流而来（渲染保持折叠） */
export type GroupedToolPart = DraftToolPart & { merged?: boolean };

export type PartGroup =
  | { type: "text"; part: ChatTextPart }
  | { type: "subagent"; part: DraftSubagentPart }
  | { type: "image"; part: DraftToolPart }
  | { type: "tools"; key: string; parts: GroupedToolPart[] };

/** 组内连续 reasoning 合流为一行（detail 以空行拼接），避免"Thought/Thought"重复行 */
function coalesceReasoning(parts: DraftToolPart[]): GroupedToolPart[] {
  const out: GroupedToolPart[] = [];
  for (const part of parts) {
    const last = out.at(-1);
    if (part.tool === "reasoning" && last?.tool === "reasoning") {
      out[out.length - 1] = {
        ...last,
        merged: true,
        detail: [last.detail, part.detail].filter(Boolean).join("\n\n") || undefined,
        status:
          last.status === "running" || part.status === "running"
            ? "running"
            : part.status,
      };
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * 顺序扫描：text 独立成组，连续 tool 并入上一组；key 取组内首个 itemId（流式稳定）。
 * 空摘要 reasoning 直接跳过；工具组内对连续 reasoning 合流——thought 仍计入统一摘要，
 * 但展开时是一段连续散文。渲染层对"仅一条 reasoning"的纯思考组免去 group→row 双层。
 * 生图与 text 同级独立成组：过程行可以折叠，画面不可以——它是回复本身。
 */
export function groupParts(parts: readonly DraftPart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const part of parts) {
    // 空摘要的 reasoning 无展示价值（Codex 部分 thought 不产 summary），跳过
    if (part.type === "tool" && part.tool === "reasoning" && !part.detail)
      continue;
    const last = groups.at(-1);
    if (part.type === "text") {
      groups.push({ type: "text", part });
    } else if (part.type === "subagent") {
      groups.push({ type: "subagent", part });
    } else if (part.tool === "image") {
      groups.push({ type: "image", part });
    } else if (last?.type === "tools") {
      last.parts.push(part);
    } else {
      groups.push({ type: "tools", key: part.itemId, parts: [part] });
    }
  }
  return groups.map((group) =>
    group.type === "tools"
      ? { ...group, parts: coalesceReasoning(group.parts) }
      : group
  );
}

type Bucket =
  | "read"
  | "command"
  | "edit"
  | "search"
  | "thought"
  | "question"
  | "tool";

// image 独立成组，不入摘要；此处保留通用桶只为让映射保持全覆盖
const KIND_BUCKETS: Record<DraftToolPart["tool"], Bucket> = {
  command: "command",
  "file-change": "edit",
  "file-read": "read",
  "web-search": "search",
  image: "tool",
  reasoning: "thought",
  "user-input": "question",
  other: "tool",
};

/** 标题以 Read 开头的条目视作读文件，优先于 kind 分桶（Codex 读文件走 other） */
const bucketOf = (part: DraftToolPart): Bucket =>
  part.title.startsWith("Read ") ? "read" : KIND_BUCKETS[part.tool];

const PHRASES: Record<Bucket, (n: number) => string> = {
  read: (n) => (n === 1 ? "read a file" : `read ${n} files`),
  command: (n) => (n === 1 ? "ran a command" : `ran ${n} commands`),
  edit: (n) => (n === 1 ? "edited a file" : `edited ${n} files`),
  search: () => "searched the web",
  thought: () => "thought",
  question: (n) => (n === 1 ? "asked a question" : `asked ${n} questions`),
  tool: (n) => (n === 1 ? "used a tool" : `used ${n} tools`),
};

/** 分桶计数按首次出现序连接，首字母大写 → "Read 2 files, ran a command" */
export function groupSummary(parts: readonly DraftToolPart[]): string {
  const counts = new Map<Bucket, number>();
  for (const part of parts) {
    const bucket = bucketOf(part);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const summary = [...counts]
    .map(([bucket, count]) => PHRASES[bucket](count))
    .join(", ");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}
