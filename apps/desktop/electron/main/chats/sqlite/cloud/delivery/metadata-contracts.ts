/**
 * [INPUT]: Depends on portable Chat facts, closed title/archive/sortKey patches and revision identities.
 * [OUTPUT]: Provides immutable local metadata intents, causal baselines and confirmed metadata state.
 * [POS]: Detail of the existing Chat outbox; runtime queues never own another copy of these facts.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "@ai-chat/cloud-protocol";
import { chatSortKeySchema, cloudChatHeadSchema, portableChatSchema } from "@ai-chat/cloud-protocol/chats/model";
import { chatMetadataPatchSchema } from "@ai-chat/cloud-protocol/chats/metadata";
const revision = z.number().int().nonnegative();
/* `.default(null)` reads observed_json rows written before sortKey existed as "never moved", so an unrelated
   title edit on an old row never diffs into a spurious sortKey patch. */
export const chatMetadataValuesSchema = z.object({ title: portableChatSchema.shape.title, archivedAt: cloudChatHeadSchema.shape.archivedAt,
  sortKey: chatSortKeySchema.nullable().default(null) }).strict();
export const chatMetadataIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), operationId: id, chat: portableChatSchema, lifecycleKind: cloudChatHeadSchema.shape.kind,
    archivedAt: cloudChatHeadSchema.shape.archivedAt }).strict(),
  z.object({ kind: z.literal("patch"), operationId: id, chatId: id, incarnationId: id, changes: chatMetadataPatchSchema,
    basis: z.discriminatedUnion("kind", [z.object({ kind: z.literal("revision"), revision }).strict(),
      z.object({ kind: z.literal("receipt"), operationId: id }).strict()]) }).strict(),
]);
export type ChatMetadataIntent = z.infer<typeof chatMetadataIntentSchema>;
export const chatMetadataStatusSchema = z.enum(["queued", "blocked", "applied", "converged", "conflicted", "deleted", "discarded"]);
export const chatMetadataLocalStateSchema = z.object({ head: cloudChatHeadSchema.nullable(), conflicted: z.boolean(), deleted: z.boolean(),
  pendingCount: revision, conflictCount: revision }).strict();
