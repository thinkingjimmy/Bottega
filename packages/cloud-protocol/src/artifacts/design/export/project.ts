/**
 * [INPUT]: Explicit complete-project choices and bounded immutable saved-cut identities.
 * [OUTPUT]: Closed whole-folder job commands and real progress states, separate from single-output producer options.
 * [POS]: Native/encrypted project export metadata; archive bytes use the existing private file channel.
 */
import { z } from "zod";
import { digestSchema } from "../reference/identifiers";
const cut = { revision: z.number().int().positive(), snapshotRef: digestSchema };
export const projectExportRequestSchema = z.object({ project: z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), ...cut }).strict(), z.object({ action: z.literal("retry"), ...cut }).strict(),
  z.object({ action: z.literal("status") }).strict(), z.object({ action: z.literal("cancel") }).strict(),
]) }).strict();
export const projectExportProgressSchema = z.object({ stage: z.enum(["versions", "resources", "archive", "complete", "validating", "publishing"]), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative().max(10000) }).strict().refine(value => value.completed <= value.total);
export const projectExportStateSchema = z.object({ state: z.enum(["running", "complete", "failed", "cancelled"]), progress: projectExportProgressSchema.optional(), error: z.string().max(1000).optional() }).strict();
export type ProjectExportRequest = z.infer<typeof projectExportRequestSchema>;
