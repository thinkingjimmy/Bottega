/**
 * [INPUT]: Zod, CommonMark scanning and untrusted text markers; ArtifactFence is type-only.
 * [OUTPUT]: Closed marker parsing, streaming segmentation and fixed rejected import projections.
 * [POS]: Text-only boundary; imported histories never load file/design validation or execute content.
 */
import { z } from "zod";
import { scanFences } from "./markdown-fences";
import type { ArtifactFence } from "./artifact-reference";
export const ARTIFACT_FENCE = "bottega-artifact";
export const ARTIFACT_LIMIT = 8;
export const ARTIFACT_MARKERS = ["\uE200visualize\uE202", "visualize{", "::codex-inline-vis{"] as const;
export function isClaudeArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["claude.ai", "preview.claude.ai"].includes(url.hostname) &&
      /^\/code\/artifact\/[A-Za-z0-9-]+\/?$/.test(url.pathname) && !url.search;
  } catch { return false; }
}
export type ArtifactReference = { path: string; title?: string; mode?: "wide" };
type ArtifactSegment = { type: "text"; text: string } | { type: "reference"; reference: ArtifactReference } |
  { type: "rejected"; reason: "unsupported" | "interrupted" };

export function parseArtifactReference(line: string): ArtifactReference | null {
  const text = line.trim();
  let value: unknown;
  try {
    if (text.startsWith(ARTIFACT_MARKERS[0]) && text.endsWith("\uE201")) value = JSON.parse(text.slice(ARTIFACT_MARKERS[0].length, -1));
    else if (text.startsWith(ARTIFACT_MARKERS[1])) value = JSON.parse(text.slice("visualize".length));
    else if (text.startsWith(ARTIFACT_MARKERS[2]) && text.endsWith("}")) {
      const body = text.slice(ARTIFACT_MARKERS[2].length, -1);
      const fields = [...body.matchAll(/(file|path|title|mode)\s*=\s*("(?:[^"\\]|\\.)*")/g)];
      let end = 0;
      const names = new Set<string>();
      for (const field of fields) {
        if (body.slice(end, field.index).trim() || names.has(field[1]!)) return null;
        names.add(field[1]!); end = field.index! + field[0].length;
      }
      if (body.slice(end).trim() || names.has("file") && names.has("path")) return null;
      const data = Object.fromEntries(fields.map(match => [match[1], JSON.parse(match[2]!)]));
      value = { path: data.file ?? data.path, ...(data.title ? { title: data.title } : {}), ...(data.mode ? { mode: data.mode } : {}) };
    } else return null;
    return z.object({ path: z.string().min(1).max(4096).refine(path => !/\p{Cc}/u.test(path)),
      title: z.string().min(1).max(250).optional(), mode: z.literal("wide").optional() }).strict().parse(value);
  } catch { return null; }
}
export function artifactTailState(line: string): "marker" | "prefix" | null {
  const text = line.trim();
  if (!text) return null;
  if (ARTIFACT_MARKERS.some(marker => text.startsWith(marker))) return "marker";
  if (ARTIFACT_MARKERS.some(marker => marker.startsWith(text))) return "prefix";
  return null;
}
/** Re-scanning is pure; the execution projector memoizes snapshots by item/path/occurrence. */
export function segmentArtifactText(text: string, finish: "stream" | "complete" | "interrupted" = "stream"): ArtifactSegment[] {
  const fences = scanFences(text), result: ArtifactSegment[] = [];
  let offset = 0;
  const append = (value: string) => {
    const last = result.at(-1);
    if (last?.type === "text") last.text += value;
    else if (value) result.push({ type: "text", text: value });
  };
  for (const segment of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!segment) continue;
    const inside = fences.some(fence => offset >= fence.start && offset < fence.end);
    offset += segment.length;
    if (inside) { append(segment); continue; }
    const line = segment.replace(/\r?\n$/, ""), tail = !segment.endsWith("\n"), state = artifactTailState(line);
    const reference = parseArtifactReference(line);
    if (reference) result.push({ type: "reference", reference });
    else if (tail && finish === "stream" && state) continue;
    else if (state === "marker") result.push({ type: "rejected", reason: finish === "interrupted" ? "interrupted" : "unsupported" });
    else { append(segment); continue; }
    if (!tail) append("\n");
  }
  return result;
}
export function projectUnavailableArtifacts(text: string): string {
  let index = 0;
  return segmentArtifactText(text, "complete").map(segment => segment.type === "text" ? segment.text :
    "```" + ARTIFACT_FENCE + "\n" + JSON.stringify({ v: 1, id: `unavailable-${index++}`, kind: "html-fragment", title: "Visualization", rejected: "unavailable" } satisfies ArtifactFence) + "\n```").join("");
}
