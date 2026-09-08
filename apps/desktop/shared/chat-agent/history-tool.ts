/**
 * [INPUT]: Depends on strict Zod contracts and read-only built-in annotations
 * [OUTPUT]: Defines the current-turn-only read_chat_history tool and shared lexical-search guidance
 * [POS]: Independent history domain; never accepts Chat IDs, paths, offsets, or generations
 */

import { z } from "zod";
import { read, type BuiltinToolSpec } from "../builtin-tools/platform";
export const HISTORY_SEARCH_GUIDANCE = "Search uses lexical AND: every whitespace-separated token must match the same saved message. " +
  "Search one distinctive term for each missing fact, not a list of unrelated questions. " +
  "When lookup is available, retrieve consequential missing facts before declaring them unsaved. " +
  "An empty result applies only to this query and search scope; follow scan-limited pageCursor or narrow the query before concluding absence.";
export const historyRefSchema = z.object({
  segment: z.enum(["native", "imported"]), messageId: z.string().min(1).max(256),
  seq: z.number().int().nonnegative(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  partId: z.string().min(1).max(256).optional(),
}).strict();
const cursor = z.string().uuid().optional();
export const historyToolInputSchema = z.object({
  mode: z.enum(["recent", "search", "around", "chunk"]), cursor,
  query: z.string().trim().min(1).max(256).describe("Lexical AND query; use a single distinctive term for one missing fact.").optional(), ref: historyRefSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const valid = value.mode === "recent" ? !value.query && !value.ref
    : value.mode === "search" ? Boolean(value.query) && !value.ref
    : value.mode === "around" ? Boolean(value.ref) && !value.query
    : Boolean(value.ref || value.cursor) && !value.query;
  if (!valid) ctx.addIssue({ code: "custom", message: "Parameters do not match the history mode" });
});
export const HISTORY_TOOL_SPECS = [{
  name: "read_chat_history", domainId: "history", access: "read",
  description: "Read saved history of this turn's current Chat only. Modes: recent, search, around, chunk. " +
    "Refs locate saved evidence, not permissions. Native text and complete imported text <=32 KiB are searchable; " +
    "larger imported bodies and saved parts require a known ref. " + HISTORY_SEARCH_GUIDANCE + " Live changes return stale; a cursor-free recent/search " +
    "explicitly refreshes the view while preserving the admitted history boundary. Never combine pages from different views. " +
    "Limits: 20 records / 16 KiB per response, 8 calls / 96 KiB per turn. Search scans at most 200 candidates / 256 KiB. " +
    "Follow pageCursor in the original mode; chunkCursor continues the same record in chunk mode. Missing content is not recreated.",
  inputSchema: historyToolInputSchema, annotations: read,
}] as const satisfies readonly BuiltinToolSpec[];
