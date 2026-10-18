/**
 * [INPUT]: Depends on strict Zod contracts and read-only built-in annotations
 * [OUTPUT]: Defines current-Chat history and source-bound attachment reads with shared lexical-search guidance
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
  mode: z.enum(["recent", "search", "around", "chunk", "attachment"]), cursor,
  query: z.string().trim().min(1).max(256).describe("Lexical AND query; use a single distinctive term for one missing fact.").optional(), ref: historyRefSchema.optional(),
  attachmentId: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "attachment") {
    if (!value.ref || value.ref.partId || !value.attachmentId || value.cursor || value.query) {
      ctx.addIssue({ code: "custom", message: "Attachment reads require a message ref and attachmentId only" });
    }
    return;
  }
  const valid = !value.attachmentId && (value.mode === "recent" ? !value.query && !value.ref
    : value.mode === "search" ? Boolean(value.query) && !value.ref
    : value.mode === "around" ? Boolean(value.ref) && !value.query
    : Boolean(value.ref || value.cursor) && !value.query);
  if (!valid) ctx.addIssue({ code: "custom", message: "Parameters do not match the history mode" });
});
export const HISTORY_TOOL_SPECS = [{
  name: "read_chat_history", domainId: "history", access: "read",
  description: "Read saved history and attachments of this turn's current Chat only. Modes: recent, search, around, chunk, attachment. " +
    "Records include saved attachments with id, filename, mediaType and byteSize. To read one, use mode=attachment with its message ref and attachmentId. " +
    "An attachment read returns a verified original file path in the current workspace and, when it fits, original PNG/JPEG image content. " +
    "Use your file/image-reading tools on the returned path when content is not inline, including large screenshots and documents. " +
    "Recover these saved files before asking the user to upload them again. " +
    "Refs locate saved evidence, not permissions. Native text and complete imported text <=32 KiB are searchable; " +
    "larger imported bodies and saved parts require a known ref. " + HISTORY_SEARCH_GUIDANCE + " Live changes return stale; a cursor-free recent/search " +
    "explicitly refreshes the view while preserving the admitted history boundary. Never combine pages from different views. " +
    "Limits: 8 calls per turn; text reads 20 records / 16 KiB per response and 96 KiB per turn; attachment results respect the current CLI wire cap and a separate 4 MiB turn budget. Search scans at most 200 candidates / 256 KiB. " +
    "Follow pageCursor in the original mode; chunkCursor continues the same record in chunk mode. Missing content is not recreated.",
  inputSchema: historyToolInputSchema, annotations: read,
}] as const satisfies readonly BuiltinToolSpec[];
