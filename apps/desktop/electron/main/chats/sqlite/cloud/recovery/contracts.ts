/**
 * [INPUT]: Depends on storage identities and immutable retained source references.
 * [OUTPUT]: Defines rooted recovery archive metadata and bounded enumeration pages.
 * [POS]: Worker-to-main recovery boundary; raw source payloads never cross renderer IPC.
 */
import { z } from "zod";
import { storageIdSchema as id, storageRevisionSchema as rev } from "../../../../../../shared/local-storage/contracts";
import { retainedSourceRefSchema } from "../delivery/contracts";
export const recoveryArchiveSchema = z.object({ archiveId: id, chatId: id, kind: z.enum(["turn", "execution", "imported", "home"]),
  createdAt: rev, messageCount: rev.nullable(), origin: z.enum(["edited", "unsent"]).nullable().default(null), source: retainedSourceRefSchema }).strict();
export const recoveryArchivePageSchema = z.object({ items: z.array(recoveryArchiveSchema).max(20), cursor: id.nullable(), complete: z.boolean() }).strict();
export type RecoveryArchive = z.infer<typeof recoveryArchiveSchema>;
