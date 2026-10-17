/**
 * [INPUT]: Closed Canvas data, immutable anchors and original request identities.
 * [OUTPUT]: Canvas operation batches, 8 KiB requests, source capability and checkpoint contracts.
 * [POS]: One shared command boundary; no caller roots, scripts or DOM write authority.
 */
import { z } from "zod";
import { designId, artifactIdSchema, digestSchema } from "../reference/identifiers";
import { anchorSchema } from "../reference/model";
import { boardSummarySchema } from "../core/summary";
import { CANVAS_LIMITS, canvasPositionSchema, canvasObjectInputSchema, canvasObjectChangesSchema,
  canvasImageSourceSchema, canvasLinkSchema, designPropertySchema } from "./model";
const title = z.string().trim().min(1).max(250), viewport = boardSummarySchema.shape.viewport, mode = boardSummarySchema.shape.mode;
const sourceChanges = z.partialRecord(designPropertySchema, z.string().max(4096)).refine(value => Object.keys(value).length > 0);
const insertion = z.union([canvasObjectInputSchema, z.object({ kind: z.literal("image"), bounds: canvasObjectInputSchema.options[0].shape.bounds,
  source: canvasImageSourceSchema, alt: z.string().max(250), style: canvasObjectInputSchema.options[0].shape.style }).strict()]);
export const canvasOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page.create"), title }).strict(),
  z.object({ type: z.literal("page.rename"), pageId: designId, title }).strict(),
  z.object({ type: z.literal("page.duplicate"), pageId: designId, title: title.optional() }).strict(),
  z.object({ type: z.literal("page.delete"), pageId: designId, confirmed: z.literal(true) }).strict(),
  z.object({ type: z.literal("board.create"), pageId: designId, title, mode, viewport, position: canvasPositionSchema }).strict(),
  z.object({ type: z.literal("board.update"), boardId: designId, title: title.optional(), pageId: designId.optional(), viewport: viewport.optional(), position: canvasPositionSchema.optional() }).strict()
    .refine(value => Object.keys(value).length > 2, "Specify a changed board field"),
  z.object({ type: z.literal("board.duplicate"), boardId: designId, pageId: designId.optional(), position: canvasPositionSchema.optional() }).strict(),
  z.object({ type: z.literal("board.delete"), boardId: designId, confirmed: z.literal(true) }).strict(),
  z.object({ type: z.literal("object.create"), pageId: designId, boardId: designId.optional(), object: insertion }).strict(),
  z.object({ type: z.literal("object.update"), objectId: designId, changes: canvasObjectChangesSchema }).strict(),
  z.object({ type: z.literal("object.duplicate"), objectId: designId, pageId: designId.optional(), boardId: designId.optional(), offset: canvasPositionSchema.optional() }).strict(),
  z.object({ type: z.literal("object.delete"), objectId: designId, confirmed: z.literal(true) }).strict(),
  z.object({ type: z.literal("source.update"), anchor: anchorSchema, changes: sourceChanges.optional(), href: canvasLinkSchema.nullable().optional(), list: z.enum(["none", "ordered", "unordered"]).optional() }).strict()
    .refine(value => value.changes || value.href !== undefined || value.list !== undefined, "Specify a source edit"),
]);
export const utf8JsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
export const canvasOperationsSchema = z.array(canvasOperationSchema).min(1).max(CANVAS_LIMITS.operations)
  .refine(value => utf8JsonBytes(value) <= CANVAS_LIMITS.operationBytes, "Canvas operations exceed 6 KiB");
export const canvasRequestSchema = z.object({ action: z.literal("canvas"), artifactId: artifactIdSchema,
  requestId: artifactIdSchema, generation: z.string().min(1).max(128), expectedRevision: z.number().int().positive(),
  readSetDigest: digestSchema, operations: canvasOperationsSchema }).strict();
export const canvasCheckpointSchema = z.object({ pageId: designId, selection: z.array(designId).max(32),
  tool: z.enum(["select", "hand", "text", "artboard", "note", "draw", "rectangle", "ellipse", "line", "arrow", "image"]), preview: z.boolean(),
  camera: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), zoom: z.number().finite().min(.05).max(3) }).strict().optional(),
  request: canvasRequestSchema.optional(),
  draft: canvasOperationsSchema.optional(),
}).strict().refine(value => new Set(value.selection).size === value.selection.length);
export const canvasTargetSchema = z.object({ anchor: anchorSchema, editable: z.boolean(), reason: z.string().max(500).nullable(),
  properties: z.array(designPropertySchema).max(17), values: z.partialRecord(designPropertySchema, z.string().max(4096)),
  text: z.boolean(), typography: z.boolean(), geometry: z.boolean(), link: z.boolean(), list: z.boolean(),
  objectId: designId.optional(), href: canvasLinkSchema.nullable().optional(), listMode: z.enum(["none", "ordered", "unordered"]).optional(),
}).strict();
export type CanvasOperation = z.infer<typeof canvasOperationSchema>;
export type CanvasRequest = z.infer<typeof canvasRequestSchema>;
export type CanvasTarget = z.infer<typeof canvasTargetSchema>;
