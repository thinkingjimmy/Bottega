/**
 * [INPUT]: Zod, static design summaries, marker constants, relative paths and CommonMark scanning.
 * [OUTPUT]: Closed streaming-safe file/design/system fences, lightweight fixed revision summaries and strict complete archive identities.
 * [POS]: Canonical artifact text contract shared by execution, history and readers.
 */
import { z } from "zod";
import { MAX_BLOB_BYTES } from "../../config";
import { scanFences } from "./markdown-fences";
import { designSummarySchema } from "../../artifacts/design/core/summary";
import { ARTIFACT_FENCE, isClaudeArtifactUrl } from "./artifact-markers";
import { artifactRelativePathSchema } from "./artifact-path";
export { ARTIFACT_FENCE, ARTIFACT_LIMIT, ARTIFACT_MARKERS, isClaudeArtifactUrl, parseArtifactReference, artifactTailState, segmentArtifactText, projectUnavailableArtifacts, type ArtifactReference } from "./artifact-markers";
export { artifactRelativePathSchema } from "./artifact-path";

const createArtifactFenceSchema = () => z.object({
  v: z.literal(1), id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  kind: z.enum(["html-fragment", "html-document", "static-site", "design", "design-system", "markdown", "svg", "image", "pdf", "docx", "pptx", "xlsx", "csv", "file", "claude-artifact", "live-app"]),
  title: z.string().min(1).max(250), mode: z.literal("wide").optional(),
  identityKey: artifactRelativePathSchema.optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), bytes: z.number().int().min(0).max(MAX_BLOB_BYTES).optional(),
  mime: z.string().min(1).max(128).optional(), entry: artifactRelativePathSchema.optional(),
  files: z.number().int().min(1).max(200).optional(), url: z.string().max(2048).refine(isClaudeArtifactUrl).optional(),
  rejected: z.enum(["path-denied", "too-large", "not-utf8", "symlink", "budget", "unsupported", "interrupted", "unavailable", "missing", "unreadable", "changed", "storage", "publish"]).optional(),
  location: z.enum(["artifacts", "workspace", "session"]).optional(),
  collection: z.enum(["tree", "dependencies", "entry-only"]).optional(),
  createdAt: z.number().int().nonnegative().optional(),
  design: designSummarySchema.optional(),
  service: z.object({ port: z.number().int().min(1).max(65535), lifecycle: z.enum(["managed", "turn"]),
    sessionId: z.string().min(1).max(128), executionDeviceId: z.string().max(128).optional() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.rejected) return;
  if (value.kind === "claude-artifact") { if (!value.url) ctx.addIssue({ code: "custom", message: "missing-artifact-url" }); return; }
  if (value.kind === "live-app") { if (!value.service) ctx.addIssue({ code: "custom", message: "missing-artifact-service" }); return; }
  if (!value.sha256 || value.bytes === undefined || !value.mime) ctx.addIssue({ code: "custom", message: "missing-artifact-snapshot" });
  if (value.kind === "static-site" && (!value.entry || !value.files)) ctx.addIssue({ code: "custom", message: "missing-artifact-entry" });
  if (["design", "design-system"].includes(value.kind) && (!value.design || value.mime !== "application/x-tar" || value.design.snapshotRef !== "sha256:" + value.sha256 ||
    (value.kind === "design-system") !== (value.design.format === "bottega-design-system"))) ctx.addIssue({ code: "custom", message: "invalid-design-summary" });
  if (value.design && !["design", "design-system"].includes(value.kind)) ctx.addIssue({ code: "custom", message: "unexpected-design-summary" });
});
// Text-only readers do not need to construct file/design validation schemas.
export const artifactFenceSchema = /* @__PURE__ */ createArtifactFenceSchema();
export type ArtifactFence = z.infer<typeof artifactFenceSchema>;
export type ArtifactKind = ArtifactFence["kind"];
export type ArtifactRejection = NonNullable<ArtifactFence["rejected"]>;
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
