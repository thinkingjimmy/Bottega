/**
 * [INPUT]: Depends on closed portable heads, verified Chat bodies and scoped identifiers.
 * [OUTPUT]: Defines independent Chat/Base/App/Project deletion cursors, mirror delivery commands and durable readiness projections.
 * [POS]: Existing SQLite synchronization contract extension; no execution authority is accepted.
 */
import { z } from "zod";
import { encryptedTurnPrefixSchema } from "@ai-chat/cloud-protocol/turns/encrypted/model";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { chatBodySchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { cloudIdSchema as id, sha256Schema as hash } from "@ai-chat/cloud-protocol";
const rev = z.number().int().nonnegative();
export const catalogTopicSchema = z.enum(["chats", "projects", "chatDeletions", "baseDeletions", "appDeletions", "projectDeletions"]);
export const catalogCursorsSchema = z.object({ chats: rev, projects: rev, chatDeletions: rev.default(0), baseDeletions: rev.default(0), appDeletions: rev.default(0), projectDeletions: rev.default(0) }).strict();
export const mirrorFilesSchema = z.object({ attachments: chatBodySchema.shape.attachments, media: chatBodySchema.shape.media }).strict();
export const mirrorBodyReferenceSchema = z.object({ sourceId: id, digest: hash, messageId: id, seq: rev.positive() }).strict();
export const mirrorDownloadSchema = z.object({ bodyRevision: rev, beforeSeq: rev, complete: z.boolean(), head: cloudChatHeadSchema,
  sourceCount: rev, emptyCount: rev.default(0) }).strict();
export const mirrorDeliveryActions = [
  z.object({ type: z.literal("apply-chat-catalog"), expectedRevision: rev, revision: rev, heads: z.array(cloudChatHeadSchema).max(50) }).strict(),
  z.object({ type: z.literal("put-mirror-head"), head: cloudChatHeadSchema }).strict(),
  z.object({ type: z.literal("advance-catalog"), topic: catalogTopicSchema, expectedRevision: rev, revision: rev }).strict(),
  z.object({ type: z.literal("begin-mirror-body"), head: cloudChatHeadSchema }).strict(),
  z.object({ type: z.literal("stage-mirror-body"), chatId: id, bodyRevision: rev, beforeSeq: rev, bodyHash: hash, body: chatBodySchema }).strict(),
  z.object({ type: z.literal("stage-mirror-empty"), chatId: id, bodyRevision: rev, beforeSeq: rev, prefix: encryptedTurnPrefixSchema }).strict(),
  z.object({ type: z.literal("complete-mirror-body"), chatId: id, bodyRevision: rev, beforeSeq: rev }).strict(),
] as const;
