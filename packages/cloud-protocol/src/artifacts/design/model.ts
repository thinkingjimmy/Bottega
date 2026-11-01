/**
 * [INPUT]: Zod, static board summaries, system parameters and bounded review evidence.
 * [OUTPUT]: Explicit native-format metadata with fixed system bindings, closed page/object manifests, bounded Canvas commands, fixed summaries, mounted-view lifetimes and semantic navigation and immutable candidate/rollback identities and existing-only prepared operation references.
 * [POS]: Shared design wire truth for desktop, encrypted delivery and Web readers.
 */
import { z } from "zod";
import { nativeOperationSchema } from "./native/operation";
import { anchorSchema, checkpointSchema, designReferenceSchema, designPropertySchema } from "./review";
import { designId, digestSchema, sourcePath, designSystemParametersSchema } from "./core/parameters";
import { boardSummarySchema } from "./core/summary";
import type { ArtifactFence } from "../../turns/text/artifact-reference";
import { canvasImageIdentitySchema, canvasPageSchema, canvasPositionSchema, canvasObjectSchema, CANVAS_LIMITS, implicitCanvasPageId } from "./canvas/model";
import { canvasOperationsSchema, utf8JsonBytes } from "./canvas/commands";
export { designId, digestSchema, sourcePath } from "./core/parameters";
export { boardSummarySchema, summarizeDesignBoards, designSummarySchema, type DesignSummary } from "./core/summary";
const systemParameters = designSystemParametersSchema.shape;
const boardSummary = boardSummarySchema.shape;
export const boardSchema = z.object({ id: boardSummary.id, title: z.string().trim().min(1).max(250),
  file: sourcePath.refine(value => /\.html$/i.test(value)), mode: boardSummary.mode, viewport: boardSummary.viewport,
  pageId: designId.optional(), position: canvasPositionSchema.optional(),
}).strict();
export const systemBindingSchema = z.object({ documentId: designId, revision: z.number().int().positive(), snapshotRef: digestSchema,
  files: z.array(sourcePath).min(1).max(64) }).strict();
export const manifestSchema = z.object({ schemaVersion: z.literal(1), format: z.enum(["bottega-design", "bottega-design-system"]),
  contentFormat: z.enum(["canvas-dc/v3", "slides/v4"]).optional(),
  documentId: designId, title: z.string().trim().min(1).max(250), boards: z.array(boardSchema).min(1).max(256), launchBoard: designId,
  systems: z.array(systemBindingSchema).max(8).optional(),
  pages: z.array(canvasPageSchema).min(1).max(CANVAS_LIMITS.pages).optional(), objects: z.array(canvasObjectSchema).max(CANVAS_LIMITS.objects).optional(),
  system: z.object({ tokens: sourcePath, aliases: sourcePath, sources: sourcePath, components: sourcePath }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.contentFormat !== "slides/v4" && value.boards.length > 16) context.addIssue({ code: "custom", message: "This document format permits at most 16 boards" });
  if (value.contentFormat && (value.format !== "bottega-design" || value.objects !== undefined || value.system !== undefined))
    context.addIssue({ code: "custom", message: "Native metadata cannot contain legacy objects or a system definition" });
  if (new Set(value.boards.map(board => board.id)).size !== value.boards.length || new Set(value.boards.map(board => board.file)).size !== value.boards.length)
    context.addIssue({ code: "custom", message: "Board IDs and files must be unique" });
  if (!value.boards.some(board => board.id === value.launchBoard)) context.addIssue({ code: "custom", message: "Missing launch board" });
  if ((value.format === "bottega-design-system") !== Boolean(value.system)) context.addIssue({ code: "custom", message: "Design systems require their source files" });
  const pages = value.pages ?? [{ id: implicitCanvasPageId(value), title: "Page 1" }], first = pages[0]!.id, ids = [...pages, ...value.boards, ...(value.objects ?? [])].map(value => value.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Pages, boards and objects require distinct IDs" });
  for (const board of value.boards) if (!pages.some(page => page.id === (board.pageId ?? first))) context.addIssue({ code: "custom", message: "Board page is missing" });
  for (const object of value.objects ?? []) {
    const board = object.boardId ? value.boards.find(board => board.id === object.boardId) : undefined;
    if (!pages.some(page => page.id === object.pageId) || object.boardId && (!board || (board.pageId ?? first) !== object.pageId)) context.addIssue({ code: "custom", message: "Object page/board membership is invalid" });
  }
});
export type DesignManifest = z.infer<typeof manifestSchema>;
export const designFrameViewSchema = z.object({ id: z.string().uuid(), nonce: z.string().uuid(), selectionNonce: z.string().uuid(), generation: z.string().min(1).max(128), boardId: designId, boardDigest: digestSchema,
  navigation: z.record(z.string().max(1024), designId).optional() }).strict();
export const workspaceCommandSchema = z.object({ chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128),
  action: z.enum(["capture-status", "retry-capture", "list", "read", "preview", "thumbnail", "cancel-thumbnail", "image", "checkpoint", "review", "reference-check", "operation-status", "resume-edit", "resolve-edit", "ack-disable", "acquire-view", "release-view", "archive", "patch", "restore", "export", "system-extract", "system-diff", "system-update", "system-bind", "system-compile", "canvas", "canvas-target", "native-editor", "native-publish", "native-download", "native-head", "native-candidate", "native-candidate-status", "native-candidate-preview", "native-candidate-ready", "native-candidate-accept", "native-candidate-discard", "native-candidate-cancel", "native-ai-rollback"]),
  artifactId: systemParameters.artifactId, documentId: designId.optional(), boardId: designId.optional(),
  exportId: z.string().regex(/^export_[a-f0-9]{64}$/).optional(), candidateId: z.string().uuid().optional(), candidateDigest: digestSchema.optional(), baselineSnapshotRef: digestSchema.optional(),
  rollbackOf: z.string().min(1).max(128).optional(), nativeOperation: nativeOperationSchema.optional(),
  image: canvasImageIdentitySchema.optional(),
  revision: z.number().int().positive().optional(), generation: z.string().min(1).max(128).optional(),
  requestId: systemParameters.requestId, expectedRevision: systemParameters.expectedRevision, readSetDigest: systemParameters.readSetDigest,
  checkpoint: checkpointSchema.optional(), nonce: z.string().uuid().optional(), viewId: z.string().uuid().optional(), anchor: anchorSchema.optional(),
  reference: designReferenceSchema.optional(),
  property: designPropertySchema.optional(),
  value: systemParameters.value, targetRevision: systemParameters.targetRevision,
  historyAction: z.enum(["undo", "redo"]).optional(),
  format: z.enum(["html", "png", "pdf-fixed", "pdf-flow"]).optional(),
  save: systemParameters.save, paper: z.enum(["a4", "letter"]).optional(),
  systemId: systemParameters.systemId, sources: systemParameters.sources,
  decisions: systemParameters.decisions,
  sourceDigest: systemParameters.sourceDigest, entry: systemParameters.entry,
  operations: canvasOperationsSchema.optional(), pageId: designId.optional(), scope: z.enum(["document", "page", "board"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.nativeOperation) {
    const operation = value.nativeOperation;
    if (value.action !== "operation-status" || !value.viewId || !value.generation || value.requestId !== operation.requestId || value.artifactId !== operation.artifactId || value.documentId !== operation.documentId)
      context.addIssue({ code: "custom", message: "Original native status requires its fixed mutation tuple and current read consumer" });
    if (utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > CANVAS_LIMITS.commandBytes)
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
  if (candidate && utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > CANVAS_LIMITS.commandBytes)
    context.addIssue({ code: "custom", message: "The complete UTF-8 candidate command exceeds 8 KiB" });
  if (value.action === "cancel-thumbnail" && (!value.requestId || !value.artifactId)) context.addIssue({ code: "custom", message: "Thumbnail cancellation requires the original request and Artifact" });
  if (value.action === "image" && (!value.image || !value.artifactId)) context.addIssue({ code: "custom", message: "Image reads require an immutable snapshot resource" });
  if (["acquire-view", "release-view", "ack-disable"].includes(value.action) && (!value.viewId || !value.documentId))
    context.addIssue({ code: "custom", message: "Workspace lifetime requires the original view and document" });
  if ((value.action === "acquire-view" && !value.artifactId) || (value.action === "ack-disable" && !value.nonce))
    context.addIssue({ code: "custom", message: "Workspace lifetime requires its Artifact or acknowledgement nonce" });
  if (value.action === "native-head" && !value.artifactId) context.addIssue({ code: "custom", message: "Native head requires the original immutable Artifact" });
  if (["native-editor", "native-publish"].includes(value.action) && (!value.artifactId || !value.generation || !value.expectedRevision || !value.readSetDigest))
    context.addIssue({ code: "custom", message: "Native editor requires its original artifact, generation, revision and digest" });
  if (value.action === "native-publish" && (!value.requestId || !value.sourceDigest))
    context.addIssue({ code: "custom", message: "Native publication requires its stable request and fixed source digest" });
  if (value.action === "canvas" && (!value.operations || !value.artifactId || !value.requestId || !value.generation || !value.expectedRevision || !value.readSetDigest))
    context.addIssue({ code: "custom", message: "Canvas requires the original artifact, generation, request, revision, digest and operations" });
  if (["canvas", "canvas-target", "native-editor", "native-publish", "native-download"].includes(value.action) && utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > CANVAS_LIMITS.commandBytes)
    context.addIssue({ code: "custom", message: "The complete UTF-8 Canvas command exceeds 8 KiB" });
});
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export type WorkspaceRead = { nativeComments?: import("./native/comments").NativeComments; aiRollback?: { requestId: string }; fence?: ArtifactFence; documentId: string; title: string; revision: number; latestRevision: number; readSetDigest: string;
  undoRevision: number | null; redoRevision: number | null;
  editable?: boolean; checkpointConflicts?: z.infer<typeof checkpointSchema>[]; statusComplete?: boolean; historyComplete?: boolean;
  snapshotRef: string; manifest: DesignManifest; generation: string; enabled: boolean; previewEnabled?: boolean; dirty: boolean;
  checkpoint: z.infer<typeof checkpointSchema> | null; versions: { revision: number; artifactId: string; createdAt: number }[];
  system?: unknown; canvas?: import("./canvas/view").CanvasRead };
