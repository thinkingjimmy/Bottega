/**
 * [INPUT]: Zod; no preview, checkpoint or browser dependencies.
 * [OUTPUT]: Closed source identifiers, read-only computed property hints, bounded source conflicts and system tool parameters.
 * [POS]: Shared validation used by workspace commands and standalone tool helpers.
 */
import { z } from "zod";
import { designId, digestSchema, artifactIdSchema } from "../reference/identifiers";
import { sourcePath } from "../reference/path";
export const DESIGN_PROPERTIES = ["text", "color", "background-color", "font-size", "padding", "gap", "width", "height",
  "font-family", "font-weight", "font-style", "text-decoration", "text-align", "line-height", "letter-spacing", "left", "top"] as const;
export { designId, digestSchema } from "../reference/identifiers";
export { sourcePath } from "../reference/path";
const writeCount = z.number().int().min(0).max(64);
export const sourceConflictSchema = z.object({ needsResolution: z.boolean(), appliedCount: writeCount,
  startedCount: writeCount, paths: z.array(sourcePath).max(8), totalPaths: z.number().int().min(0).max(128) }).strict();

export const designSystemParametersSchema = z.object({
  artifactId: artifactIdSchema.optional(), requestId: artifactIdSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional(), readSetDigest: digestSchema.optional(),
  value: z.string().max(4096).optional(), targetRevision: z.number().int().positive().optional(),
  save: z.boolean().optional(), systemId: designId.optional(), sources: z.array(sourcePath).min(1).max(32).optional(),
  decisions: z.record(z.string().max(128), z.enum(["keep", "source", "delete"])).optional(),
  sourceDigest: digestSchema.optional(), entry: sourcePath.optional(),
}).strict();
