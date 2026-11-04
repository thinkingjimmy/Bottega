/**
 * [INPUT]: Zod, static board summaries, system parameters and bounded review evidence.
 * [OUTPUT]: Explicit native-format metadata with fixed system bindings, distinct current native/system manifests, current native/system commands, fixed summaries and mounted-view lifetimes and immutable candidate/rollback identities and existing-only prepared operation references.
 * [POS]: Shared design wire truth for desktop, encrypted delivery and Web readers.
 */
import { z } from "zod";
import { nativeTargetHintSchema } from "./chat/evidence";
import { nativeHistoryRequestSchema } from "./history/model";
import { nativeOperationSchema } from "./native/operation";
import { anchorSchema, checkpointSchema, designReferenceSchema } from "./review";
import { designId, digestSchema, sourcePath, designSystemParametersSchema } from "./core/parameters";
import { boardSummarySchema } from "./core/summary";
import type { ArtifactFence } from "../../turns/text/artifact-reference";
import { DESIGN_COMMAND_BYTES, utf8JsonBytes } from "./core/transport";
export { designId, digestSchema, sourcePath } from "./core/parameters";
export { boardSummarySchema, summarizeDesignBoards, designSummarySchema, type DesignSummary } from "./core/summary";
const systemParameters = designSystemParametersSchema.shape;
const boardSummary = boardSummarySchema.shape;
export const boardSchema = z.object({ id: boardSummary.id, title: z.string().trim().min(1).max(250),
  file: sourcePath.refine(value => /\.html$/i.test(value) || value === "db/files/index.html.json"), mode: boardSummary.mode, viewport: boardSummary.viewport,
  pageId: designId.optional(), position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict().optional(),
}).strict();
export const systemBindingSchema = z.object({ documentId: designId, revision: z.number().int().positive(), snapshotRef: digestSchema,
  files: z.array(sourcePath).min(1).max(64), copy: z.object({ path: sourcePath, digest: digestSchema }).strict().optional() }).strict();
const commonManifest = {
  schemaVersion: z.literal(1), documentId: designId, title: z.string().trim().min(1).max(250),
  boards: z.array(boardSchema).min(1).max(256), launchBoard: designId,
};
export const nativeManifestSchema = z.object({ ...commonManifest, format: z.literal("bottega-design"),
  contentFormat: z.enum(["canvas-dc/v3", "slides/v4", "dashboard/v1"]),
  systems: z.array(systemBindingSchema).max(8).optional(),
  pages: z.array(z.object({ id: designId, title: z.string().trim().min(1).max(250) }).strict()).min(1).max(16).optional(),
  system: z.never().optional(),
}).strict();
export const systemManifestSchema = z.object({ ...commonManifest, format: z.literal("bottega-design-system"),
  contentFormat: z.never().optional(),
  system: z.object({ tokens: sourcePath, aliases: sourcePath, sources: sourcePath, components: sourcePath }).strict(),
  systems: z.never().optional(), pages: z.never().optional(),
}).strict();
export const manifestSchema = z.discriminatedUnion("format", [nativeManifestSchema, systemManifestSchema]).superRefine((value, context) => {
  for (const board of value.boards) if (value.contentFormat === "dashboard/v1" ? board.file !== "db/files/index.html.json" : !/\.html$/i.test(board.file))
    context.addIssue({ code: "custom", message: "The board source must match its explicit content format" });
  if (value.contentFormat === "dashboard/v1" && (value.boards.length !== 1 || value.systems?.length || value.pages?.length)) context.addIssue({ code: "custom", message: "Dashboard has one page and no Canvas/Slides system bindings" });
  if (value.contentFormat !== "slides/v4" && value.boards.length > 16) context.addIssue({ code: "custom", message: "This document format permits at most 16 boards" });
  if (new Set(value.boards.map(board => board.id)).size !== value.boards.length || new Set(value.boards.map(board => board.file)).size !== value.boards.length)
    context.addIssue({ code: "custom", message: "Board IDs and files must be unique" });
  if (!value.boards.some(board => board.id === value.launchBoard)) context.addIssue({ code: "custom", message: "Missing launch board" });
  const pages = value.pages ?? [], ids = [...pages, ...value.boards].map(item => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Pages and boards require distinct IDs" });
  for (const board of value.boards) if (board.pageId && !pages.some(page => page.id === board.pageId)) context.addIssue({ code: "custom", message: "Board page is missing" });
});
export type DesignManifest = z.infer<typeof manifestSchema>;
export const designFrameViewSchema = z.object({ id: z.string().uuid(), nonce: z.string().uuid(), generation: z.string().min(1).max(128), boardId: designId, boardDigest: digestSchema,
  navigation: z.record(z.string().max(1024), designId).optional() }).strict();
export const workspaceCommandSchema = z.object({ chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128),
  action: z.enum(["capture-status", "retry-capture", "list", "read", "preview", "thumbnail", "cancel-thumbnail", "checkpoint", "review", "reference-check", "operation-status", "resume-edit", "resolve-edit", "ack-disable", "acquire-view", "release-view", "archive", "export", "system-extract", "system-diff", "system-update", "system-bind", "system-compile", "native-editor", "native-publish", "native-download", "native-head", "native-candidate", "native-candidate-status", "native-candidate-preview", "native-candidate-ready", "native-candidate-accept", "native-candidate-discard", "native-candidate-cancel", "native-ai-rollback", "native-history-list", "native-history-detail", "native-history-diff", "native-history-restore", "native-reference", "native-chat-apply", "native-locate", "native-project-import", "native-project-choose"]),
  artifactId: systemParameters.artifactId, documentId: designId.optional(), boardId: designId.optional(),
  exportId: z.string().regex(/^export_[a-f0-9]{64}$/).optional(), candidateId: z.string().uuid().optional(), candidateDigest: digestSchema.optional(), baselineSnapshotRef: digestSchema.optional(),
  rollbackOf: z.string().min(1).max(128).optional(), nativeOperation: nativeOperationSchema.optional(),
  projectFileId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  revision: z.number().int().positive().optional(), generation: z.string().min(1).max(128).optional(),
  requestId: systemParameters.requestId, expectedRevision: systemParameters.expectedRevision, readSetDigest: systemParameters.readSetDigest,
  checkpoint: checkpointSchema.optional(), nonce: z.string().uuid().optional(), viewId: z.string().uuid().optional(), anchor: anchorSchema.optional(),
  reference: designReferenceSchema.optional(),
  history: nativeHistoryRequestSchema.optional(), nativeCommentId: z.string().min(1).max(128).optional(), nativeTarget: nativeTargetHintSchema.optional(),
  value: systemParameters.value, targetRevision: systemParameters.targetRevision,
  format: z.enum(["html", "png", "pdf-fixed", "pdf-flow"]).optional(),
  save: systemParameters.save, paper: z.enum(["a4", "letter"]).optional(),
  systemId: systemParameters.systemId, sources: systemParameters.sources,
  decisions: systemParameters.decisions,
  sourceDigest: systemParameters.sourceDigest, entry: systemParameters.entry,
  scope: z.enum(["document", "board"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "native-project-choose" && (!value.requestId || !value.generation || value.artifactId || value.sourceDigest || value.projectFileId || value.expectedRevision)) context.addIssue({ code: "custom", message: "Project selection requires a new host request without source or existing write authority" });
  if (value.action.startsWith("native-project-") && utf8JsonBytes(value) > DESIGN_COMMAND_BYTES - 128) context.addIssue({ code: "custom", message: "Project command exceeds 8 KiB" });
  if (value.action === "native-project-import" && (!value.requestId || !value.generation || !value.sourceDigest || value.artifactId || value.expectedRevision || value.history)) context.addIssue({ code: "custom", message: "Project import requires a new host request and fixed bytes, without existing write authority" });
  if (value.action === "native-reference" && (!value.artifactId || !value.generation || !value.nativeCommentId && !value.value?.trim())) context.addIssue({ code: "custom", message: "Native reference requires saved source and explicit comment or instruction" });
  const history = value.action.startsWith("native-history-");
  if (history) {
    if (!value.artifactId || !value.documentId || !value.history) context.addIssue({ code: "custom", message: "History requires its original document and fixed selectors" });
    if (value.action !== "native-history-list" && !value.history?.revision) context.addIssue({ code: "custom", message: "History requires a fixed revision" });
    if (value.action === "native-history-restore" && (!value.requestId || !value.generation || !value.expectedRevision || !value.readSetDigest || !value.history?.compareRevision)) context.addIssue({ code: "custom", message: "Restore requires current CAS and compared revision" });
    if (utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > DESIGN_COMMAND_BYTES) context.addIssue({ code: "custom", message: "History command exceeds 8 KiB" });
  } else if (value.history) context.addIssue({ code: "custom", message: "History selectors require a History action" });
  if (value.nativeOperation) {
    const operation = value.nativeOperation;
    if (value.action !== "operation-status" || !value.viewId || !value.generation || value.requestId !== operation.requestId || value.artifactId !== operation.artifactId || value.documentId !== operation.documentId)
      context.addIssue({ code: "custom", message: "Original native status requires its fixed mutation tuple and current read consumer" });
    if (utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > DESIGN_COMMAND_BYTES)
      context.addIssue({ code: "custom", message: "The complete native status command exceeds 8 KiB" });
  }
  if (value.action === "native-download" && (!value.artifactId || !value.requestId || !value.nonce || !value.exportId || !value.sourceDigest))
    context.addIssue({ code: "custom", message: "Native download requires its exact original view, request and retained output identity" });
  const candidate = value.action.startsWith("native-candidate") || value.action === "native-ai-rollback";
  if (candidate && (!value.artifactId || !value.documentId || !value.viewId || !value.generation))
    context.addIssue({ code: "custom", message: "Candidate action requires its original Artifact, document, view and generation" });
  if (["native-candidate", "native-candidate-accept", "native-ai-rollback"].includes(value.action) && (!value.requestId || !value.expectedRevision || !value.readSetDigest))
    context.addIssue({ code: "custom", message: "Candidate mutation requires its stable request and exact saved source baseline" });
  if (value.action === "native-candidate" && !value.value?.trim()) context.addIssue({ code: "custom", message: "Candidate generation requires the user's instructions" });
  if (["native-candidate-preview", "native-candidate-ready", "native-candidate-accept", "native-candidate-discard"].includes(value.action) && (!value.candidateId || !value.candidateDigest))
    context.addIssue({ code: "custom", message: "Candidate action requires the exact displayed sealed identity" });
  if (value.action === "native-candidate-cancel" && (!value.requestId || !value.candidateId)) context.addIssue({ code: "custom", message: "Candidate stop requires its exact original task identity" });
  if (value.action === "native-candidate-ready" && !value.nonce) context.addIssue({ code: "custom", message: "Candidate readiness requires its preview lease" });
  if (value.action === "native-ai-rollback" && !value.rollbackOf) context.addIssue({ code: "custom", message: "AI rollback requires its original accepted operation" });
  if (candidate && utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > DESIGN_COMMAND_BYTES)
    context.addIssue({ code: "custom", message: "The complete UTF-8 candidate command exceeds 8 KiB" });
  if (value.action === "cancel-thumbnail" && (!value.requestId || !value.artifactId)) context.addIssue({ code: "custom", message: "Thumbnail cancellation requires the original request and Artifact" });
  if (["acquire-view", "release-view", "ack-disable"].includes(value.action) && (!value.viewId || !value.documentId))
    context.addIssue({ code: "custom", message: "Workspace lifetime requires the original view and document" });
  if ((value.action === "acquire-view" && !value.artifactId) || (value.action === "ack-disable" && !value.nonce))
    context.addIssue({ code: "custom", message: "Workspace lifetime requires its Artifact or acknowledgement nonce" });
  if (value.action === "native-head" && !value.artifactId) context.addIssue({ code: "custom", message: "Native head requires the original immutable Artifact" });
  if (["native-editor", "native-publish"].includes(value.action) && (!value.artifactId || !value.generation || !value.expectedRevision || !value.readSetDigest))
    context.addIssue({ code: "custom", message: "Native editor requires its original artifact, generation, revision and digest" });
  if (value.action === "native-publish" && (!value.requestId || !value.sourceDigest))
    context.addIssue({ code: "custom", message: "Native publication requires its stable request and fixed source digest" });
  if (["native-editor", "native-publish", "native-download"].includes(value.action) && utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > DESIGN_COMMAND_BYTES)
    context.addIssue({ code: "custom", message: "The complete UTF-8 Canvas command exceeds 8 KiB" });
});
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export type WorkspaceRead = { pendingChatEdit?: import("./chat/model").PendingArtifactChatSave; nativeComments?: import("./native/comments").NativeComments; aiRollback?: { requestId: string }; fence?: ArtifactFence; documentId: string; title: string; revision: number; latestRevision: number; readSetDigest: string;
  editable?: boolean; checkpointConflicts?: z.infer<typeof checkpointSchema>[]; statusComplete?: boolean; historyComplete?: boolean;
  snapshotRef: string; manifest: DesignManifest; generation: string; enabled: boolean; previewEnabled?: boolean; dirty: boolean;
  checkpoint: z.infer<typeof checkpointSchema> | null; versions: { revision: number; artifactId: string; createdAt: number }[];
  system?: unknown };
