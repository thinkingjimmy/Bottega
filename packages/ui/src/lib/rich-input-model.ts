/**
 * [INPUT]: Depends on PromptInput RichNode/RichValue type, multi-kind suggestion groups and browser UTF-16 selection zone deviation syntax
 * [OUTPUT]: Provides RichInput Specification/Range/Caret, skill/mention Queries, Filter by group limit, Multi-Trigger/Multi-Kind Projection, including the unified identity of entryKind
 * [POS]: The RichInput documentation of ui/lib and the candidate's single truth; DOM adapters are responsible for selecting zone translations and pure projection rendering only
 */

import type {
  RichNode,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import type {
  RichInputSuggestion,
  RichQuery,
  RichSuggestionGroup,
} from "../components/ai-elements/rich-input-types";

export type {
  RichQuery,
  RichSuggestionGroup,
} from "../components/ai-elements/rich-input-types";

export type RichCaretPoint = { index: number; offset: number };
export type RichRange = { start: number; end: number };
type SearchableSuggestion = {
  label: string;
  name?: string;
  description: string;
};

const nodeLength = (node: RichNode) =>
  node.type === "text" ? node.value.length : 1;

export function normalizeRichValue(value: RichValue): RichValue {
  const result: RichValue = [];
  for (const node of value) {
    if (node.type === "text" && !node.value) continue;
    const previous = result.at(-1);
    if (node.type === "text" && previous?.type === "text") {
      previous.value += node.value;
    } else {
      result.push({ ...node });
    }
  }
  return result;
}

export const richValueLength = (value: RichValue) =>
  value.reduce((total, node) => total + nodeLength(node), 0);

function sliceRichValue(value: RichValue, start: number, end: number) {
  const result: RichValue = [];
  let cursor = 0;
  for (const node of value) {
    const nextCursor = cursor + nodeLength(node);
    if (node.type === "text") {
      const from = Math.max(start, cursor) - cursor;
      const to = Math.min(end, nextCursor) - cursor;
      if (from < to) result.push({ ...node, value: node.value.slice(from, to) });
    } else if (cursor >= start && nextCursor <= end) {
      result.push({ ...node });
    }
    cursor = nextCursor;
  }
  return result;
}

export function replaceRichRange(
  value: RichValue,
  range: RichRange,
  text: string,
  createTextId: () => string = () => crypto.randomUUID()
) {
  const length = richValueLength(value);
  const start = Math.max(0, Math.min(range.start, range.end, length));
  const end = Math.max(start, Math.min(Math.max(range.start, range.end), length));
  const next = normalizeRichValue([
    ...sliceRichValue(value, 0, start),
    ...(text ? [{ id: createTextId(), type: "text" as const, value: text }] : []),
    ...sliceRichValue(value, end, length),
  ]);
  return { value: next, caret: start + text.length };
}

export function pointAtRichOffset(
  value: RichValue,
  rawOffset: number
): RichCaretPoint {
  const target = Math.max(0, Math.min(rawOffset, richValueLength(value)));
  let cursor = 0;
  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];
    if (node.type === "text" && target <= cursor + node.value.length) {
      return { index, offset: target - cursor };
    }
    if (node.type !== "text" && target === cursor) {
      return { index, offset: 0 };
    }
    cursor += nodeLength(node);
  }
  return { index: value.length, offset: 0 };
}

export function richQueryAtPoint(
  value: RichValue,
  point: RichCaretPoint
): RichQuery | null {
  const node = value[point.index];
  if (node?.type !== "text") return null;
  const text = node.value.slice(0, point.offset);
  const match = /(?:^|\s)(\p{Sc}|@)(\S*)$/u.exec(text);
  if (!match) return null;
  return {
    kind: match[1] === "@" ? "mention" : "skill",
    nodeId: node.id,
    start: text.length - match[1].length - match[2].length,
    value: match[2],
  };
}

const normalizedSearchText = (value: string) =>
  value.normalize("NFKC").toLowerCase();

function suggestionSearchRank(item: SearchableSuggestion, query: string) {
  const names = [item.label, item.name]
    .filter((name): name is string => Boolean(name))
    .map(normalizedSearchText);
  if (names.some((name) => name.startsWith(query))) return 0;
  if (names.some((name) => name.includes(query))) return 1;
  return normalizedSearchText(item.description).includes(query) ? 2 : null;
}

export function searchRichSuggestions<T extends SearchableSuggestion>(
  suggestions: readonly T[],
  rawQuery: string
): T[] {
  const query = normalizedSearchText(rawQuery);
  if (!query) return [...suggestions];
  return suggestions
    .map((item, index) => ({
      index,
      item,
      rank: suggestionSearchRank(item, query),
    }))
    .filter(
      (entry): entry is typeof entry & { rank: number } =>
        entry.rank !== null
    )
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item);
}

export type SuggestionProjection = {
  groups: Array<RichSuggestionGroup & { items: RichInputSuggestion[] }>;
  flat: RichInputSuggestion[];
};

const groupTriggers = (group: RichSuggestionGroup) =>
  group.triggers ?? [group.kind === "skill" ? "skill" : "mention"];

const groupKinds = (group: RichSuggestionGroup) =>
  group.kinds ?? [group.kind];

export function projectRichSuggestions({
  query,
  suggestions,
  groups = [],
}: {
  query: RichQuery | null;
  suggestions: readonly RichInputSuggestion[];
  groups?: readonly RichSuggestionGroup[];
}): SuggestionProjection {
  if (!query) return { groups: [], flat: [] };
  const projected = groups.flatMap((group) => {
    if (!groupTriggers(group).includes(query.kind)) return [];
    const kinds = groupKinds(group);
    const source = suggestions.filter((item) => kinds.includes(item.kind));
    const matches =
      kinds.length === 1 && kinds[0] === "workspace-file"
        ? source
        : searchRichSuggestions(source, query.value);
    const items =
      typeof group.limit === "number"
        ? matches.slice(0, Math.max(0, group.limit))
        : matches;
    return items.length > 0 || group.note
      ? [{ ...group, items }]
      : [];
  });
  return {
    groups: projected,
    flat: projected.flatMap((group) => group.items),
  };
}

export function normalizeSuggestionIndex(selected: number, length: number) {
  if (length <= 0) return null;
  return ((selected % length) + length) % length;
}

export function suggestionKey(item: RichInputSuggestion) {
  if (item.kind === "skill") return `skill:${item.ref}`;
  if (item.kind === "section") return `section:${item.chatId}`;
  if (item.kind === "history") return `history:${item.opaqueId}`;
  return `file:${item.entryKind === "dir" ? "dir" : "file"}:${item.path}`;
}
