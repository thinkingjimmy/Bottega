/**
 * [INPUT]: Depends on the shared/history-import-ipc ForeignToolEvent and the shared/chat-turn-reducer DraftToolPart
 * [OUTPUT]: Provides projectForeignTools; Projecting the event of the outsourced native tool to the product DraftToolPart ((native name classification + actual input refinement title + detail cutting), making the historical tool to go along with the product's native history to share TurnParts in the same rendering language
 * [POS]: The external source tool for chat/transcript projects a pure function; Active session kind from ACP wire, historical side only native tool names, here sorted by full library test name family in 08-22 four source {claude/codex/kimi/opencode}
 */

import type { DraftToolPart } from "../../../../shared/chat-turn-reducer";
import type { ForeignToolEvent } from "../../../../shared/history-import-ipc";

type Json = Record<string, unknown>;
type ToolKind = DraftToolPart["tool"];

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
const DETAIL_LIMIT = 16_384;

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

export function projectForeignTools(tools: readonly ForeignToolEvent[] | undefined): DraftToolPart[] {
  return (tools ?? []).map((tool) => {
    const kind = kindOf(tool.name);
    const title = argTitle(parsedArgs(tool.input)) ?? tool.name;
    // command 的标题已是命令本身，详情只留终端输出；其余工具实参与结果并陈
    const detail = kind === "command"
      ? tool.output
      : [tool.input, tool.output].filter(Boolean).join("\n\n") || undefined;
    return {
      type: "tool",
      itemId: tool.id,
      tool: kind,
      title: clip(title.replace(/\s+/g, " ").trim(), TITLE_LIMIT) || tool.name,
      ...(detail ? { detail: clip(detail, DETAIL_LIMIT) } : {}),
      status: "completed",
    };
  });
}
