/**
 * [INPUT]: Depends on closed portable bodies, private blob descriptors and bounded identities.
 * [OUTPUT]: Defines fixed-purpose archive/candidate discovery and reading requests.
 * [POS]: Credential-free main-frame boundary; retained sources and filesystem locations stay in main.
 */
import { z } from "zod";
import { cloudIdSchema as id, blobDescriptorSchema } from "@ai-chat/cloud-protocol";
import { chatBodySchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { importedEntrySchema } from "@ai-chat/cloud-protocol/chats/imported/model";
import { homeEntrySchema } from "@ai-chat/cloud-protocol/chats/home/model";
const rev = z.number().int().nonnegative().safe();
export const recoveryIdentitySchema = z.object({ chatId: id, archiveId: id }).strict();
export const recoveryPageRequestSchema = recoveryIdentitySchema.extend({ before: rev.nullable() }).strict();
export const recoveryFileRequestSchema = recoveryIdentitySchema.extend({ messageId: id, descriptor: blobDescriptorSchema }).strict();
export const recoverySummarySchema = z.object({ archiveId: id, chatId: id, kind: z.enum(["turn", "execution", "imported", "home"]),
  createdAt: rev, messageCount: rev.nullable(), origin: z.enum(["edited", "unsent"]).nullable().default(null) }).strict();
export const recoveryPageSchema = z.object({ archive: recoverySummarySchema, messages: z.array(chatBodySchema).max(20),
  home: z.object({ pending: z.boolean(), files: rev, omitted: rev, unavailable: z.boolean().optional() }).strict().nullable().default(null),
  imported: z.array(importedEntrySchema).max(20).default([]), files: z.array(homeEntrySchema).max(20).default([]),
  cursor: rev.nullable(), complete: z.boolean() }).strict();
export type RecoveryIdentity = z.infer<typeof recoveryIdentitySchema>;
export type RecoverySummary = z.infer<typeof recoverySummarySchema>;
export type RecoveryPage = z.infer<typeof recoveryPageSchema>;
export const retainedCatalogRequestSchema = z.object({ afterId: id.nullable() }).strict();
const retainedCatalogEntrySchema = recoverySummarySchema.extend({ kind: z.enum(["turn", "execution", "imported", "home", "metadata"]), title: z.string().max(500).nullable() }).strict();
export const retainedCatalogSchema = z.object({ items: z.array(retainedCatalogEntrySchema).max(20), cursor: id.nullable(), complete: z.boolean() }).strict();
export const retainedMetadataSchema = z.object({ title: z.string().max(500).nullable(),
  edits: z.array(z.object({ operationId: id, title: z.string().max(500).nullable().optional(), archived: z.boolean().optional() }).strict()).max(20),
  cursor: rev.nullable(), complete: z.boolean() }).strict();
export type RetainedCatalog = z.infer<typeof retainedCatalogSchema>;
export type RetainedMetadata = z.infer<typeof retainedMetadataSchema>;
