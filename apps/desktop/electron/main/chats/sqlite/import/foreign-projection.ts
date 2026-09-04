/**
 * [INPUT]: Depends on the shared ForeignToolEvent/ForeignProcessStep wire shapes, the imported tool-detail cap and the canonical ChatPart/part budgets
 * [OUTPUT]: Provides projectForeignTools and projectForeignParts; imported tool events and folded intermediate statements become canonical ChatParts (native kind classification, argument-derived title, 16 KiB-capped detail) inside one shared message byte budget
 * [POS]: Pure projection beside the SQLite import reader; imported rows therefore speak the same TurnParts language as native history
 */

import type { ChatPart, ChatToolPart } from "../../../../../shared/chats-ipc";
import { MESSAGE_PART_LIMIT } from "../../../../../shared/chats-ipc";
import { IMPORTED_TOOL_DETAIL_BYTE_LIMIT } from "../../../../../shared/agent-ipc";
import type {
  ForeignProcessStep,
  ForeignToolEvent,
} from "../../../../../shared/history-import-ipc";
import { PART_TITLE_CHAR_LIMIT } from "../../chat-schema";

type Json = Record<string, unknown>;
type ToolKind = ChatToolPart["tool"];

/* ── 原生名 → kind：claude/kimi（Bash/Read/Edit…同形家族）、codex
 * （exec_command/run…）与 opencode（小写 bash/read/patch…）四家实测词表；
 * 未列入者一律 other，图标退扳手，不冒认。──── */
const KIND_PATTERNS: ReadonlyArray<readonly [RegExp, ToolKind]> = [
  [/^(exec_command|shell(_command)?|local_shell|bash|write_stdin|wait|js|js_reset|read_thread_terminal)$/, "command"],
  [/^(read|read_file|readmediafile|view_image|grep|glob|list|ls)$/, "file-read"],
  [/^(edit|multiedit|write|notebookedit|apply_patch|patch)$/, "file-change"],
  [/^(run|web_?search|web_?fetch|fetch)$/, "web-search"],
  [/^(askuserquestion|request_user_input)$/, "user-input"],
];

/* 标题候选按信息密度排序：js 的自述 title、命令行、文件路径、检索词。
 * description 殿后——Bash 同时带 command 与 description，命令行才是本相。 */
const TITLE_KEYS = ["title", "cmd", "command", "file_path", "path", "url", "query", "pattern", "skill", "description"] as const;

const TITLE_LIMIT = 200;

const kindOf = (name: string): ToolKind =>
  KIND_PATTERNS.find(([pattern]) => pattern.test(name.toLowerCase()))?.[1] ?? "other";

const object = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const string = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const first = (value: unknown) => (Array.isArray(value) ? value[0] : null);

const parsedArgs = (input: string | undefined): Json | null => {
  if (!input) return null;
  try { return object(JSON.parse(input)); } catch { return null; }
};

const clip = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

/* 省略号自己要 3 个字节，再留一个字节给被切断的码点。预算比这还小时
   subarray(0, limit - 4) 会绕成负数下标，把「几乎整段详情」当成剪过的
   结果交出去——一条消息于是超出 32 KB 预算，整条记录落不了盘。 */
const CLIP_ELLIPSIS_BYTES = 4;

function clipBytes(value: string, limit: number) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= limit) return value;
  const kept = Math.max(0, limit - CLIP_ELLIPSIS_BYTES);
  return `${bytes.subarray(0, kept).toString("utf8").replace(/�$/u, "")}…`;
}

function argTitle(args: Json | null): string | null {
  if (!args) return null;
  for (const key of TITLE_KEYS) {
    const value = string(args[key]);
    if (value) return value;
  }
  // 结构化候选：codex run 的首个检索词 / 双端问询工具的首个问题
  return (
    string(object(first(args.search_query))?.q) ??
    string(object(first(args.questions))?.question)
  );
}

/* 预算是入参而非常量：这些 part 与正文共享同一条 32 KB 消息预算，
   超出即整条 record 落不进 chatRecordSchema。宁可少给几行工具详情，
   也不让一条超长的导入消息把整段历史读成异常。 */
type Budget = { bytes: number; parts: number };

function toolParts(
  tools: readonly ForeignToolEvent[] | undefined,
  budget: Budget
): ChatToolPart[] {
  const parts: ChatToolPart[] = [];
  for (const tool of tools ?? []) {
    if (budget.parts <= 0) break;
    const kind = kindOf(tool.name);
    const title = clip(
      (argTitle(parsedArgs(tool.input)) ?? tool.name).replace(/\s+/g, " ").trim(),
      TITLE_LIMIT
    ) || tool.name;
    const titleBytes = Buffer.byteLength(title, "utf8");
    if (titleBytes > budget.bytes) break;
    budget.bytes -= titleBytes;
    // command 的标题已是命令本身，详情只留终端输出；其余工具实参与结果并陈
    const raw = kind === "command"
      ? tool.output
      : [tool.input, tool.output].filter(Boolean).join("\n\n") || undefined;
    // 预算连一个省略号都装不下时，这条详情整段让位，而不是剪成半截。
    const detail = raw && budget.bytes > CLIP_ELLIPSIS_BYTES
      ? clipBytes(raw, Math.min(IMPORTED_TOOL_DETAIL_BYTE_LIMIT, budget.bytes))
      : undefined;
    if (detail) budget.bytes -= Buffer.byteLength(detail, "utf8");
    parts.push({
      type: "tool",
      itemId: clip(tool.id, 256),
      tool: kind,
      title: clip(title, PART_TITLE_CHAR_LIMIT),
      ...(detail ? { detail } : {}),
      status: "completed",
    });
    budget.parts -= 1;
  }
  return parts;
}

export function projectForeignTools(
  tools: readonly ForeignToolEvent[] | undefined,
  budgetBytes: number
): ChatToolPart[] {
  return toolParts(tools, { bytes: budgetBytes, parts: MESSAGE_PART_LIMIT });
}

/**
 * 折叠后的一条 assistant：逐条摊开被折进来的中间陈述，每一步先它的工具、
 * 再它的文字——一条 assistant 消息挂着的工具是**跑在它之前**的那些调用，
 * 反过来排就会让「先说后做」的假象顶替真实时序（JSON 时代 groupTurns
 * 同律）。末条自己的工具殿后；文本与工具共用同一条消息预算游标。
 */
export function projectForeignParts(input: {
  process?: readonly ForeignProcessStep[];
  tools?: readonly ForeignToolEvent[];
  budgetBytes: number;
  itemIdPrefix: string;
}): ChatPart[] {
  const budget: Budget = { bytes: input.budgetBytes, parts: MESSAGE_PART_LIMIT };
  const parts: ChatPart[] = [];
  (input.process ?? []).forEach((step, index) => {
    parts.push(...toolParts(step.tools, budget));
    const text = step.text.trim();
    if (!text || budget.parts <= 0 || budget.bytes <= CLIP_ELLIPSIS_BYTES) return;
    const clipped = clipBytes(text, budget.bytes);
    parts.push({
      type: "text",
      itemId: clip(`${input.itemIdPrefix}:process-${index}`, 256),
      text: clipped,
    });
    budget.bytes -= Buffer.byteLength(clipped, "utf8");
    budget.parts -= 1;
  });
  parts.push(...toolParts(input.tools, budget));
  return parts;
}
