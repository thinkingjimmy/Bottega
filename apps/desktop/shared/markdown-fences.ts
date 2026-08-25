/**
 * [INPUT]: Accepts the independent Markdown clip; Scanning UTF-16 character deviations by CommonMark fencing rules
 * [OUTPUT]: Provides scanFences, capChartFences and MarkdownFragment, sharing the renderer quota and main security interrupt
 * [POS]: The Markdown Fence is the single source of shared truthI don't know about React, Electron or Perpetuation
 */

export type MarkdownFragment = {
  id: string;
  markdown: string;
};

export type MarkdownFence = {
  start: number;
  end: number;
  openerEnd: number;
  closerStart?: number;
  marker: "`" | "~";
  markerLength: number;
  language: string;
  closed: boolean;
};

const CONTAINER_PREFIX =
  /^(?:(?: {0,3}>[ \t]?)|(?: {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+)){0,3}/;

function lineBody(line: string) {
  const withoutContainer = line.replace(CONTAINER_PREFIX, "");
  const spaces = withoutContainer.match(/^ */)?.[0].length ?? 0;
  return spaces <= 3 ? withoutContainer.slice(spaces) : null;
}

function opener(line: string) {
  const body = lineBody(line);
  if (body === null) return null;
  const match = /^(`{3,}|~{3,})([^\r\n]*)$/.exec(body);
  if (!match) return null;
  const marker = match[1]![0] as "`" | "~";
  const info = match[2]!.trim();
  if (marker === "`" && info.includes("`")) return null;
  return {
    marker,
    markerLength: match[1]!.length,
    language: info.split(/[ \t]/, 1)[0]?.toLowerCase() ?? "",
  };
}

function isCloser(line: string, active: Pick<MarkdownFence, "marker" | "markerLength">) {
  const body = lineBody(line);
  if (body === null) return false;
  const escaped = active.marker === "`" ? "`" : "~";
  const match = new RegExp(`^(${escaped}{${active.markerLength},})[ \\t]*$`).exec(body);
  return Boolean(match);
}

export function scanFences(markdown: string): MarkdownFence[] {
  const fences: MarkdownFence[] = [];
  let active: MarkdownFence | null = null;
  let offset = 0;
  for (const segment of markdown.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!segment) continue;
    const line = segment.replace(/\r?\n$/, "");
    const nextOffset = offset + segment.length;
    if (!active) {
      const found = opener(line);
      if (found) {
        active = {
          ...found,
          start: offset,
          openerEnd: nextOffset,
          end: markdown.length,
          closed: false,
        };
      }
    } else if (isCloser(line, active)) {
      active = {
        ...active,
        closerStart: offset,
        end: nextOffset,
        closed: true,
      };
      fences.push(active);
      active = null;
    }
    offset = nextOffset;
  }
  if (active) fences.push(active);
  return fences;
}

export function capChartFences(
  fragments: readonly MarkdownFragment[],
  limit = 8
): MarkdownFragment[] {
  let seen = 0;
  return fragments.map((fragment) => {
    let markdown = fragment.markdown;
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    for (const fence of scanFences(markdown)) {
      if (fence.language !== "chart") continue;
      seen += 1;
      if (seen <= limit) continue;
      const openerText = markdown.slice(fence.start, fence.openerEnd);
      const languageIndex = openerText.toLowerCase().indexOf("chart");
      if (languageIndex < 0) continue;
      replacements.push({
        start: fence.start + languageIndex,
        end: fence.start + languageIndex + "chart".length,
        value: "chart-overflow",
      });
    }
    for (const replacement of replacements.reverse()) {
      markdown =
        markdown.slice(0, replacement.start) +
        replacement.value +
        markdown.slice(replacement.end);
    }
    return { ...fragment, markdown };
  });
}
