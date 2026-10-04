/**
 * [INPUT]: Uses Zod and the shared CommonMark fence scanner.
 * [OUTPUT]: Provides closed artifact fences, reference parsing and streaming-safe text segments.
 * [POS]: Canonical artifact text contract shared by execution, history and readers.
 */
import { z } from "zod";
import { MAX_BLOB_BYTES } from "../../config";
import { scanFences } from "./markdown-fences";

export const ARTIFACT_FENCE = "bottega-artifact";
export const ARTIFACT_LIMIT = 8;
export const ARTIFACT_MARKERS = ["\uE200visualize\uE202", "visualize{", "::codex-inline-vis{"] as const;
export const artifactRelativePathSchema = z.string().min(1).max(1024).refine(value =>
  !/[\\\p{Cc}:]/u.test(value) && !value.startsWith("/") &&
  value.split("/").every(part => part !== "" && part !== "." && part !== ".." && !part.startsWith(".")));
export function isClaudeArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["claude.ai", "preview.claude.ai"].includes(url.hostname) &&
      /^\/code\/artifact\/[A-Za-z0-9-]+\/?$/.test(url.pathname) && !url.search;
  } catch { return false; }
}
export const artifactFenceSchema = z.object({
  v: z.literal(1), id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  kind: z.enum(["html-fragment", "html-document", "static-site", "markdown", "svg", "image", "pdf", "docx", "pptx", "xlsx", "csv", "file", "claude-artifact", "live-app"]),
  title: z.string().min(1).max(250), mode: z.literal("wide").optional(),
  identityKey: artifactRelativePathSchema.optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), bytes: z.number().int().min(0).max(MAX_BLOB_BYTES).optional(),
  mime: z.string().min(1).max(128).optional(), entry: artifactRelativePathSchema.optional(),
  files: z.number().int().min(1).max(200).optional(), url: z.string().max(2048).refine(isClaudeArtifactUrl).optional(),
  rejected: z.enum(["path-denied", "too-large", "not-utf8", "symlink", "budget", "unsupported", "interrupted", "unavailable"]).optional(),
  location: z.enum(["artifacts", "workspace", "session"]).optional(),
  collection: z.enum(["tree", "dependencies", "entry-only"]).optional(),
  createdAt: z.number().int().nonnegative().optional(),
  service: z.object({ port: z.number().int().min(1).max(65535), lifecycle: z.enum(["managed", "turn"]),
    sessionId: z.string().min(1).max(128), executionDeviceId: z.string().max(128).optional() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.rejected) return;
  if (value.kind === "claude-artifact") { if (!value.url) ctx.addIssue({ code: "custom", message: "missing-artifact-url" }); return; }
  if (value.kind === "live-app") { if (!value.service) ctx.addIssue({ code: "custom", message: "missing-artifact-service" }); return; }
  if (!value.sha256 || value.bytes === undefined || !value.mime) ctx.addIssue({ code: "custom", message: "missing-artifact-snapshot" });
  if (value.kind === "static-site" && (!value.entry || !value.files)) ctx.addIssue({ code: "custom", message: "missing-artifact-entry" });
});
export type ArtifactFence = z.infer<typeof artifactFenceSchema>;
export type ArtifactKind = ArtifactFence["kind"];
export type ArtifactRejection = NonNullable<ArtifactFence["rejected"]>;
export type ArtifactReference = { path: string; title?: string; mode?: "wide" };
type ArtifactSegment = { type: "text"; text: string } | { type: "reference"; reference: ArtifactReference } |
  { type: "rejected"; reason: "unsupported" | "interrupted" };

export function encodeArtifactFence(fence: ArtifactFence): string {
  return "```" + ARTIFACT_FENCE + "\n" + JSON.stringify(artifactFenceSchema.parse(fence)).replace(/`/g, "\\u0060") + "\n```";
}
export function decodeArtifactFence(text: string): ArtifactFence | null {
  if (text.length > 8192) return null;
  try { return artifactFenceSchema.parse(JSON.parse(text)); } catch { return null; }
}
export function readArtifactFences(text: string): ArtifactFence[] {
  return scanFences(text).filter(fence => fence.language === ARTIFACT_FENCE && fence.closed)
    .flatMap(fence => { const value = decodeArtifactFence(text.slice(fence.openerEnd, fence.closerStart)); return value ? [value] : []; });
}
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
    encodeArtifactFence({ v: 1, id: `unavailable-${index++}`, kind: "html-fragment", title: "Visualization", rejected: "unavailable" })).join("");
}
