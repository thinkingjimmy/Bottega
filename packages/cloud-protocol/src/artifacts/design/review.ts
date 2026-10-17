/**
 * [INPUT]: Zod, lightweight fixed references and user-authored review text.
 * [OUTPUT]: Bounded anchors, Canvas/edit/annotation/camera checkpoints and original-Chat handoff text.
 * [POS]: Shared review evidence; hints are data and never grant execution authority.
 */
import { z } from "zod";
import { anchorSchema } from "./reference/model";
import { designPropertySchema, sourceConflictSchema } from "./core/parameters";
import { canvasCheckpointSchema } from "./canvas/commands";
export { designPropertySchema } from "./core/parameters";
export { anchorSchema, designReferenceSchema, type DesignAnchor, type DesignReference } from "./reference/model";
export const editCheckpointSchema = z.object({ property: designPropertySchema, value: z.string().max(4096), anchor: anchorSchema.nullable(),
  request: z.object({ action: z.enum(["patch", "restore"]), artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    generation: z.string().min(1).max(128), expectedRevision: z.number().int().nonnegative(), readSetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    targetRevision: z.number().int().positive().optional(), historyAction: z.enum(["undo", "redo"]).optional(), property: designPropertySchema.optional(), value: z.string().max(4096).optional(), anchor: anchorSchema.optional() }).strict().optional(),
  sourceConflict: sourceConflictSchema.optional() }).strict();
export const systemCheckpointSchema = z.object({ token: z.string().max(64), theme: z.string().max(32), value: z.string().max(1000), sourcesText: z.string().max(4096),
  decisions: z.record(z.string().max(128), z.enum(["keep", "source", "delete"])), sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  systemId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(), targetRevision: z.number().int().positive().optional(), propsText: z.string().max(4096).optional(),
  request: z.object({ action: z.enum(["system-update", "system-bind", "system-compile"]), artifactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    generation: z.string().min(1).max(128), expectedRevision: z.number().int().nonnegative(), readSetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    systemId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(), targetRevision: z.number().int().positive().optional(),
    entry: z.string().max(240).optional(), value: z.string().max(4096).optional(), sources: z.array(z.string().max(240)).max(32).optional(),
    sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(), decisions: z.record(z.string().max(128), z.enum(["keep", "source", "delete"])).optional() }).strict().optional(),
  sourceConflict: sourceConflictSchema.optional() }).strict();
export const noteSchema = z.object({ id: z.string().min(1).max(128), text: z.string().max(4096), anchor: anchorSchema.nullable() }).strict();
export const checkpointSchema = z.object({ documentId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  revision: z.number().int().positive(), boardId: z.string().min(1).max(64), notes: z.array(noteSchema).max(32),
  handoff: z.object({ id: z.string().uuid(), createdAt: z.number().int().nonnegative(), action: z.enum(["draft", "send"]), status: z.enum(["pending", "transferred"]) }).strict().optional(),
  edit: editCheckpointSchema.optional(),
  system: systemCheckpointSchema.optional(),
  canvas: canvasCheckpointSchema.safeExtend({ sourceConflict: sourceConflictSchema.optional() }).optional(),
  annotation: z.object({ id: z.string().uuid(), text: z.string().max(4096), anchor: anchorSchema, noteId: z.string().max(128).optional() }).strict().optional(),
  view: z.object({ mode: z.enum(["focus", "overview"]), cameras: z.record(z.string().max(128), z.object({ width: z.number().min(40).max(8000), zoom: z.number().min(.05).max(3), fit: z.enum(["board", "width", "manual"]) }).strict()).refine(value => Object.keys(value).length <= 32) }).strict().optional(),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 32 * 1024 &&
  new Set(value.notes.map(note => note.id)).size === value.notes.length, "Review exceeds its budget or repeats a note ID");
export type DesignCheckpoint = z.infer<typeof checkpointSchema>;
export function formatDesignReview(value: DesignCheckpoint, _digest: string) {
  return value.notes.map((note, index) => `${index + 1}. ${note.text}`).join("\n");
}
