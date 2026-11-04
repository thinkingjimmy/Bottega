/**
 * [INPUT]: Zod and closed design identifiers; no review or workspace command schemas.
 * [OUTPUT]: Format-tagged fixed board/revision summaries for message fences and history readers.
 * [POS]: Static design metadata boundary shared with document manifests.
 */
import { z } from "zod";
import { designId, digestSchema } from "../reference/identifiers";

export const boardSummarySchema = z.object({ id: designId, title: z.string().min(1).max(80), mode: z.enum(["responsive", "fixed"]),
  viewport: z.object({ width: z.number().int().min(40).max(8000), height: z.number().int().min(40).max(8000) }).strict(),
}).strict();
export const summarizeDesignBoards = (manifest: { contentFormat?: string; launchBoard?: string; boards: (z.infer<typeof boardSummarySchema> & { file: string })[] }) => {
  const selected = manifest.contentFormat === "slides/v4" ? manifest.boards.slice(0, 16) : manifest.boards;
  const cover = manifest.boards.find(board => board.id === manifest.launchBoard);
  if (cover && !selected.some(board => board.id === cover.id)) selected.splice(15, 1, cover);
  return selected.map(board => ({ id: board.id, title: board.title.slice(0, 80), mode: board.mode, viewport: board.viewport }));
};
const createDesignSummarySchema = () => {
  const common = { documentId: designId, revision: z.number().int().positive(), readSetDigest: digestSchema, snapshotRef: digestSchema,
    launchBoard: designId, boards: z.array(boardSummarySchema).min(1).max(16), boardCount: z.number().int().min(1).max(256).optional(), executionDeviceId: z.string().min(1).max(128).optional() };
  return z.discriminatedUnion("format", [
    z.object({ ...common, format: z.literal("bottega-design"), contentFormat: z.enum(["canvas-dc/v3", "slides/v4", "dashboard/v1"]) }).strict(),
    z.object({ ...common, format: z.literal("bottega-design-system"), contentFormat: z.never().optional() }).strict(),
  ]).superRefine((value, context) => {
    if (value.contentFormat === "slides/v4" ? value.boardCount === undefined || value.boardCount < value.boards.length : value.boardCount !== undefined)
      context.addIssue({ code: "custom", message: "Slides summaries require their complete page count" });
    if (!value.boards.some(board => board.id === value.launchBoard)) context.addIssue({ code: "custom", message: "Summary must contain its launch board" });
  });
};
export const designSummarySchema = /* @__PURE__ */ createDesignSummarySchema();
export type DesignSummary = z.infer<typeof designSummarySchema>;
