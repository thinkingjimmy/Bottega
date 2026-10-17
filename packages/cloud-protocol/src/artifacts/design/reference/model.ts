/**
 * [INPUT]: Zod and immutable board/Chat evidence; no workspace or checkpoint schemas.
 * [OUTPUT]: Bounded anchors, optional normalized bounds/computed property hints and immutable design references.
 * [POS]: Lightweight input contract for draft, queue and remote command readers.
 */
import { z } from "zod";
import { designId, digestSchema, artifactIdSchema } from "./identifiers";
import { boardSummarySchema } from "../core/summary";
import { DESIGN_PROPERTIES } from "../canvas/model";
const boundsSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().refine(value => value.x + value.width <= 1.001 && value.y + value.height <= 1.001);
export const anchorSchema = z.object({ boardId: designId,
  boardDigest: digestSchema, selector: z.string().min(1).max(500).nullable(),
  currentText: z.string().max(2048), region: boundsSchema.nullable(), bounds: boundsSchema.optional(),
  properties: z.object(Object.fromEntries(DESIGN_PROPERTIES.filter(value => value !== "text").map(value => [value, z.string().max(200).optional()])) as Record<Exclude<typeof DESIGN_PROPERTIES[number], "text">, z.ZodOptional<z.ZodString>>).strict().optional(),
  viewport: boardSummarySchema.shape.viewport.extend({ scrollX: z.number().min(0).max(1_000_000), scrollY: z.number().min(0).max(1_000_000) }).strict().optional(),
  sourceLine: z.number().int().positive().max(1_000_000).optional(),
  file: z.string().min(1).max(240).regex(/^[A-Za-z0-9_][A-Za-z0-9_. /-]*$/).optional(),
}).strict().refine(value => Boolean(value.selector) !== Boolean(value.region), "Choose one element or one region");
export type DesignAnchor = z.infer<typeof anchorSchema>;
export const designReferenceSchema = z.object({ artifactId: artifactIdSchema, documentId: designId,
  revision: z.number().int().positive(), readSetDigest: digestSchema, generation: z.string().min(1).max(128),
  anchors: z.record(z.string().regex(/^(?:[1-9]|[12][0-9]|3[0-2])$/), anchorSchema.nullable()).refine(value => Object.keys(value).length <= 32).optional() }).strict();
export type DesignReference = import("@bottega/contracts/model/artifacts/design").DesignReference;
