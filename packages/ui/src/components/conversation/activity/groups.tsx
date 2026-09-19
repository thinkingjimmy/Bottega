/**
 * [INPUT]: Depends on structural text, tool and subagent presentation data.
 * [OUTPUT]: Groups consecutive tools, coalesces reasoning and produces the native activity summaries.
 * [POS]: Shared activity projection; generic payloads retain host-owned media and subagent capabilities.
 */
export type ActivityTool = { type: "tool"; itemId: string; tool: "command" | "file-change" | "file-read" | "web-search" | "image" | "reasoning" | "agent-failure" | "user-input" | "other"; title: string; detail?: string; status: "running" | "completed" | "failed" };
type ActivityPart = ActivityTool | { type: "text"; itemId: string; text: string } | { type: "subagent"; itemId: string };
type DraftToolPart = ActivityTool;
type ChatTextPart = Extract<ActivityPart, { type: "text" }>;
type DraftSubagentPart = Extract<ActivityPart, { type: "subagent" }>;
export type GroupedToolPart = DraftToolPart & { merged?: boolean };

type BasePartGroup =
  | { type: "text"; part: ChatTextPart }
  | { type: "subagent"; part: DraftSubagentPart }
  | { type: "image"; part: DraftToolPart }
  | { type: "failure"; part: DraftToolPart }
  | { type: "tools"; key: string; parts: GroupedToolPart[] };

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

export type PartGroup<T extends ActivityPart = ActivityPart> =
  | { type: "text"; part: Extract<T, { type: "text" }> }
  | { type: "subagent"; part: Extract<T, { type: "subagent" }> }
  | { type: "image"; part: Extract<T, { type: "tool" }> }
  | { type: "failure"; part: Extract<T, { type: "tool" }> }
  | { type: "tools"; key: string; parts: (Extract<T, { type: "tool" }> & { merged?: boolean })[] };
export function groupParts<T extends ActivityPart>(parts: readonly T[]): PartGroup<T>[] {
  const groups: BasePartGroup[] = [];
  for (const part of parts) {
    if (part.type === "tool" && part.tool === "reasoning" && !part.detail)
      continue;
    const last = groups.at(-1);
    if (part.type === "text") {
      groups.push({ type: "text", part });
    } else if (part.type === "subagent") {
      groups.push({ type: "subagent", part });
    } else if (part.tool === "image") {
      groups.push({ type: "image", part });
    } else if (part.tool === "agent-failure") {
      groups.push({ type: "failure", part });
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
  ) as PartGroup<T>[];
}

type Bucket =
  | "read"
  | "command"
  | "edit"
  | "search"
  | "thought"
  | "question"
  | "tool";
const KIND_BUCKETS: Record<DraftToolPart["tool"], Bucket> = {
  command: "command",
  "file-change": "edit",
  "file-read": "read",
  "web-search": "search",
  image: "tool",
  reasoning: "thought",
  "user-input": "question",
  "agent-failure": "tool",
  other: "tool",
};

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
