/**
 * [INPUT]: Depends on authenticated Chat heads, canonical content hashing and local revision/hash codecs.
 * [OUTPUT]: Defines two-phase canonical adoption, the divergence point the commit reuses and the divergence-keyed recovered child identity.
 * [POS]: Main-to-worker convergence contract; the independent child must exist before replacement.
 */
import { z } from "zod";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { storageIdSchema as id, storageHashSchema as hash, storageRevisionSchema as rev, type SyncScope } from "../../../../../../shared/local-storage/contracts";
const target = z.object({ head: cloudChatHeadSchema, expectedMessageRevision: rev, expectedOutboxDigest: hash,
  initial: z.object({ id: z.string().min(1).max(384), payloadDigest: hash }).strict().nullable() });
export const prepareConvergenceSchema = target.extend({ type: z.literal("prepare-chat-convergence") }).strict();
/* startSeq carries the divergence point found while preparing: the commit reuses it instead of
   re-reading every canonical body, and a wrong one produces a different archive identity below. */
export const commitConvergenceSchema = target.extend({ type: z.literal("commit-chat-convergence"), archiveId: id.nullable(), childId: id.nullable(), startSeq: rev.positive().nullable() }).strict();
export const convergenceResultSchema = z.object({ chatId: id, archiveId: id.nullable(), startSeq: rev.positive().nullable(), committed: z.boolean() }).strict();
/* The recovered child is keyed by the divergence it rescues, never by the archived bytes: a commit
   that loses its fence because the user finished another turn archives more content on the retry, and
   a content key would hand that retry a second "X (n)" Fork over an overlapping tail. */
export type ChatDivergence = { chatId: string; incarnationId: string; startSeq: number };
export const recoveredForkKey = (scope: SyncScope, divergence: ChatDivergence) => hashChatContent([scope, divergence]);
export const recoveredForkChildId = (scope: SyncScope, divergence: ChatDivergence) => `recovered_${recoveredForkKey(scope, divergence).slice(0, 32)}`;
