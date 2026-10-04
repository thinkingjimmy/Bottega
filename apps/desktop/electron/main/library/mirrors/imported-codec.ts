/**
 * [INPUT]: Depends on existing foreign-history field names and shared completion metadata.
 * [OUTPUT]: Validates the lossless additive source field in external transcript lines.
 * [POS]: Shared parser for worker exports and folder imports; excludes source paths and capabilities.
 */
import { z } from "zod";
import { completionMetadataSchema } from "../../../../shared/local-storage/contracts";
const tool = z.object({ id: z.string(), name: z.string(), input: z.string().optional(), output: z.string().optional(), ...completionMetadataSchema.shape });
export const sourceSchema = z.object({ kind: z.literal("message"), id: z.string(), nativeTurnId: z.string(), deliverySeq: z.number().int().positive(), role: z.enum(["user", "assistant"]),
  content: z.string(), createdAt: z.number().int().nonnegative(), tools: z.array(tool).optional(), process: z.array(z.object({ text: z.string(), tools: z.array(tool).optional() })).optional(),
  workedForMs: z.number().nonnegative().optional(), plan: z.literal(true).optional(), ...completionMetadataSchema.shape });
