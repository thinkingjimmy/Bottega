/**
 * [INPUT]: Depends on closed portable imported-history identities and server receipts.
 * [OUTPUT]: Defines immutable imported content checkpoints in ChatStore's original outbox.
 * [POS]: Local delivery codec; source files remain under existing import retention roots.
 */
import { z } from "zod";
import { importedEntrySchema, importManifestSchema, importReceiptSchema, importStatusSchema } from "@ai-chat/cloud-protocol/chats/imported/model";
export const importedCheckpoints = [
  z.object({ kind: z.literal("import-entry"), entry: importedEntrySchema }).strict(),
  z.object({ kind: z.literal("import-manifest"), manifest: importManifestSchema }).strict(),
  z.object({ kind: z.literal("import-page"), receipt: importReceiptSchema }).strict(),
  z.object({ kind: z.literal("import-complete"), status: importStatusSchema.refine(value => value.state === "ready") }).strict(),
] as const;
