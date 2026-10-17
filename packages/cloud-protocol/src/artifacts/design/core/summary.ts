/**
 * [INPUT]: Zod and closed design identifiers; no review or workspace command schemas.
 * [OUTPUT]: Fixed board/revision summaries for message fences and history readers.
 * [POS]: Static design metadata boundary shared with document manifests.
 */
import { z } from "zod";
import { designId, digestSchema } from "../reference/identifiers";

export const boardSummarySchema = z.object({ id: designId, title: z.string().min(1).max(80), mode: z.enum(["responsive", "fixed"]),
  viewport: z.object({ width: z.number().int().min(40).max(8000), height: z.number().int().min(40).max(8000) }).strict(),
}).strict();
export const summarizeDesignBoards = (manifest: { boards: (z.infer<typeof boardSummarySchema> & { file: string })[] }) => manifest.boards.map(board => ({ id: board.id, title: board.title.slice(0, 80), mode: board.mode, viewport: board.viewport }));
const createDesignSummarySchema = () => z.object({ documentId: designId, revision: z.number().int().positive(),
  readSetDigest: digestSchema, snapshotRef: digestSchema, launchBoard: designId, boards: z.array(boardSummarySchema).min(1).max(16),
  format: z.enum(["bottega-design", "bottega-design-system"]), executionDeviceId: z.string().min(1).max(128).optional(),
}).strict();
export const designSummarySchema = /* @__PURE__ */ createDesignSummarySchema();
export type DesignSummary = z.infer<typeof designSummarySchema>;
