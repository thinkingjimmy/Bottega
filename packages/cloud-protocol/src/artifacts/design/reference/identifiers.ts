/**
 * [INPUT]: Zod; no tool, preview or checkpoint definitions.
 * [OUTPUT]: Closed design IDs, Artifact IDs and snapshot digests.
 * [POS]: Scalar boundary for static metadata, source capture and finite command parameters.
 */
import { z } from "zod";
export const designId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const artifactIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
