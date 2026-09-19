/**
 * [INPUT]: Depends on validated imported tool/process fields, shared completion evidence and canonical content budgets.
 * [OUTPUT]: Decodes individual or packed activity and projects ordered native text/tool parts, with bounded UTF-8 detail and original completion state.
 * [POS]: Browser-capable projection shared by SQLite history and Cloud Web; never executes source tool content.
 */
import { z } from "zod";
import { projectUnavailableArtifacts } from "../../turns/text/artifact-reference";
import { completionFields, completionMetadataSchema } from "../content/completion";
import type { ChatPart, ChatToolPart } from "../content/parts";
import { MESSAGE_PART_LIMIT, IMPORTED_TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT } from "../content/budgets";
export const importedToolSchema = z.object({ id: z.string(), name: z.string(), input: z.string().optional(), output: z.string().optional(), ...completionFields });
export const importedProcessSchema = z.object({ text: z.string(), tools: z.array(importedToolSchema).optional() });
export function decodeImportedActivityField(field: string, value: unknown) {
  if (field === "process") return { process: z.array(importedProcessSchema).parse(value) };
  if (field === "tools") return { tools: z.array(importedToolSchema).parse(value) };
  if (field.startsWith("process-")) return { process: [importedProcessSchema.parse(value)] };
  if (field.startsWith("tool-")) return { tools: [importedToolSchema.parse(value)] };
  return null;
}
type ForeignToolEvent = z.infer<typeof importedToolSchema>;
type ForeignProcessStep = z.infer<typeof importedProcessSchema>;
type Json = Record<string, unknown>;
type ToolKind = ChatToolPart["tool"];

const KIND_PATTERNS: ReadonlyArray<readonly [RegExp, ToolKind]> = [
  [/^(exec_command|shell(_command)?|local_shell|bash|write_stdin|wait|js|js_reset|read_thread_terminal)$/, "command"],
  [/^(read|read_file|readmediafile|view_image|grep|glob|list|ls)$/, "file-read"],
  [/^(edit|multiedit|write|notebookedit|apply_patch|patch)$/, "file-change"],
  [/^(run|web_?search|web_?fetch|fetch)$/, "web-search"],
  [/^(askuserquestion|request_user_input)$/, "user-input"],
];

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

const CLIP_ELLIPSIS_BYTES = 4;

function clipBytes(value: string, limit: number) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= limit) return value;
  const kept = Math.max(0, limit - CLIP_ELLIPSIS_BYTES);
  return `${new TextDecoder().decode(bytes.subarray(0, kept)).replace(/�$/u, "")}…`;
}

function argTitle(args: Json | null): string | null {
  if (!args) return null;
  for (const key of TITLE_KEYS) {
    const value = string(args[key]);
    if (value) return value;
  }
  return (
    string(object(first(args.search_query))?.q) ??
    string(object(first(args.questions))?.question)
  );
}

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
    const titleBytes = new TextEncoder().encode(title).byteLength;
    if (titleBytes > budget.bytes) break;
    budget.bytes -= titleBytes;
    const raw = kind === "command"
      ? tool.output
      : [tool.input, tool.output].filter(Boolean).join("\n\n") || undefined;
    const detail = raw && budget.bytes > CLIP_ELLIPSIS_BYTES
      ? clipBytes(raw, Math.min(IMPORTED_TOOL_DETAIL_BYTE_LIMIT, budget.bytes))
      : undefined;
    if (detail) budget.bytes -= new TextEncoder().encode(detail).byteLength;
    parts.push({
      type: "tool",
      itemId: clip(tool.id, 256),
      tool: kind,
      title: clip(title, PART_TITLE_CHAR_LIMIT),
      ...(detail ? { detail } : {}),
      ...completionMetadataSchema.parse(tool),
      status: tool.completion === "interrupted" ? "failed" : "completed",
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
    const text = projectUnavailableArtifacts(step.text.trim());
    if (!text || budget.parts <= 0 || budget.bytes <= CLIP_ELLIPSIS_BYTES) return;
    const clipped = clipBytes(text, budget.bytes);
    parts.push({
      type: "text",
      itemId: clip(`${input.itemIdPrefix}:process-${index}`, 256),
      text: clipped,
    });
    budget.bytes -= new TextEncoder().encode(clipped).byteLength;
    budget.parts -= 1;
  });
  parts.push(...toolParts(input.tools, budget));
  return parts;
}
