/**
 * [INPUT]: Closed Artifact capability, finite command parameters and reference-only anchors and scoped thumbnail cancellation.
 * [OUTPUT]: Bounded catalog/Canvas capability replies and UTF-8-limited remote design commands.
 * [POS]: Existing encrypted resource transport; archives use private file transfer.
 */
import { z } from "zod";
import { artifactCapabilitySchema } from "../../artifacts/design/core/capability";
import { designId, digestSchema } from "../../artifacts/design/reference/identifiers";
import { anchorSchema } from "../../artifacts/design/reference/model";
import { designSystemParametersSchema, designPropertySchema, sourceConflictSchema } from "../../artifacts/design/core/parameters";
import { artifactFenceSchema } from "../../turns/text/artifact-reference";
import { canvasOperationsSchema, canvasTargetSchema, utf8JsonBytes } from "../../artifacts/design/canvas/commands";
import { CANVAS_LIMITS } from "../../artifacts/design/canvas/model";
export const artifactStatusInput = z.object({ chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128), cursor: designId.nullable() }).strict();
export const artifactHistoryInput = z.object({ chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128),
  artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), cursor: z.number().int().nonnegative() }).strict();
const remoteScope = { chatId: z.string().min(1).max(128), incarnationId: z.string().min(1).max(128) };
export const artifactOperationInput = z.object({ ...remoteScope,
  ...designSystemParametersSchema.pick({ artifactId: true, requestId: true }).required().shape,
  action: z.literal("operation-status"),
}).strict();
export const artifactRemoteInput = z.object({ ...remoteScope,
  action: z.enum(["capture-status", "retry-capture", "patch", "restore", "export", "thumbnail", "cancel-thumbnail", "operation-status", "resume-edit", "resolve-edit", "system-diff", "system-bind", "system-update", "system-compile", "canvas", "canvas-target"]),
  ...designSystemParametersSchema.omit({ save: true }).shape,
  historyAction: z.enum(["undo", "redo"]).optional(),
  boardId: designId.optional(), generation: z.string().min(1).max(128).optional(),
  anchor: anchorSchema.optional(), property: designPropertySchema.optional(),
  format: z.enum(["html", "png", "pdf-fixed", "pdf-flow"]).optional(), paper: z.enum(["a4", "letter"]).optional(),
  operations: canvasOperationsSchema.optional(), pageId: designId.optional(), scope: z.enum(["document", "page", "board"]).optional(),
}).strict().refine(value => Boolean(value.artifactId) && (["capture-status", "system-diff", "canvas-target"].includes(value.action) || Boolean(value.requestId)),
  "Use a version-bound design action; save on the reading device").superRefine((value, context) => {
  if (value.action === "canvas" && (!value.operations || !value.generation || !value.expectedRevision || !value.readSetDigest)) context.addIssue({ code: "custom", message: "Canvas requires its complete original request" });
  if (utf8JsonBytes({ contract: "bottega.resource/v1", action: "artifact-workspace", input: value }) > CANVAS_LIMITS.commandBytes) context.addIssue({ code: "custom", message: "Complete resource command exceeds 8 KiB" });
});
export const artifactCanvasTargetSchema = canvasTargetSchema.refine(value => utf8JsonBytes({ ok: true, artifactCanvasTarget: value }) <= CANVAS_LIMITS.commandBytes, "Source capability reply exceeds 8 KiB");
export const artifactStatusSchema = z.object({ capability: artifactCapabilitySchema, cursor: designId.nullable(),
  documents: z.array(z.object({ documentId: designId, title: z.string().max(250), artifactId: z.string().max(128), revision: z.number().int().positive(),
    snapshotRef: digestSchema, readSetDigest: digestSchema, bytes: z.number().int().nonnegative(), format: z.enum(["bottega-design", "bottega-design-system"]), dirty: z.boolean(),
    undoRevision: z.number().int().positive().nullable(), redoRevision: z.number().int().positive().nullable() }).strict()).max(8) }).strict();
export const artifactOperationSchema = z.object({ status: z.enum(["committed", "pending", "conflict"]), requestId: z.string().max(128),
  code: z.literal("SOURCE_CHANGED").optional(), sourceConflict: sourceConflictSchema.optional(),
  documentId: designId.optional(), revision: z.number().int().positive().optional(), readSetDigest: digestSchema.optional(), snapshotRef: digestSchema.optional(),
  artifactId: z.string().max(128).optional(), operationRef: z.string().max(512).optional(),
  recovery: z.object({ status: z.enum(["retrying", "paused", "authority-blocked"]), attempts: z.number().int().nonnegative(),
    nextRetryAt: z.number().nonnegative().optional(), code: z.string().max(128), message: z.string().max(500), action: z.string().max(500) }).strict().optional() }).strict()
  .refine(value => value.status === "conflict" ? value.code === "SOURCE_CHANGED" && Boolean(value.sourceConflict) : !value.code && !value.sourceConflict, "Source conflicts require their bounded result");
export const artifactCancellationSchema = z.object({ cancelled: z.boolean() }).strict();
export const artifactExportSchema = z.object({ fence: artifactFenceSchema, filename: z.string().min(1).max(128),
  revision: z.number().int().positive(), snapshotRef: digestSchema, readSetDigest: digestSchema,
  published: z.boolean() }).strict();
export const artifactHistorySchema = z.object({ cursor: z.number().int().positive().nullable(), versions: artifactStatusSchema.shape.documents }).strict();
export const artifactDifferenceSchema = z.object({ status: z.literal("difference"), sourceDigest: digestSchema,
  total: z.number().int().nonnegative(), cursor: z.number().int().nonnegative(), nextCursor: z.number().int().positive().nullable(),
  changes: z.array(z.object({ key: z.string().max(128), family: z.enum(["token", "alias", "component"]), kind: z.enum(["added", "changed", "removed", "conflict"]), requiresDecision: z.boolean(),
    base: z.string().max(160).nullable(), current: z.string().max(160).nullable(), incoming: z.string().max(160).nullable() }).strict()).max(8),
  unsynced: z.array(z.object({ path: z.string().max(240), kind: z.string().max(80), name: z.string().max(80).optional(), reason: z.string().max(160) }).strict()).max(4),
  unsyncedTotal: z.number().int().nonnegative(), unsyncedCursor: z.number().int().nonnegative(), nextUnsyncedCursor: z.number().int().positive().nullable() }).strict();
