/**
 * [INPUT]: Required current account/space headers and immutable ciphertext message contracts.
 * [OUTPUT]: Explicit bounded block access and original-time range membership without search terms.
 * [POS]: Shared body/query wire slice; recent reads filter membership before any ciphertext block transfer.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as header } from "../../../spaces";
import { cloudIdSchema as id } from "../../../auth";
import { versionSchema as rev } from "../../../scalars";
import { messageMembershipSchema } from "../../../encryption/domains/messages";
import { encryptedMessageBlockSchema, encryptedBodyStageSchema, encryptedBodyStatusSchema, encryptedMessageSchema, MESSAGE_CIPHER_LIMITS } from "./model";
import { encryptedTurnPrefixSchema } from "../../../turns/encrypted/model";
export const encryptedMessageFunctions = {
  "chats/body/api:stageBlock": { kind: "mutation", args: header.extend({ chatId: id, incarnationId: id, executionEpoch: rev, block: encryptedMessageBlockSchema }).strict(),
    result: z.object({ blockId: id, ciphertextHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict() },
  "chats/body/api:stage": { kind: "mutation", args: header.extend({ candidate: encryptedBodyStageSchema }).strict(), result: encryptedBodyStatusSchema },
  "chats/body/reads:current": { kind: "query", args: header.extend({ membership: messageMembershipSchema, bodyHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), result: z.object({ current: z.boolean() }).strict() },
  "chats/body/reads:block": { kind: "query", args: header.extend({ chatId: id, bodyHash: z.string().regex(/^[a-f0-9]{64}$/), blockId: id }).strict(), result: encryptedMessageBlockSchema },
  "chats/body/reads:blocks": { kind: "query", args: header.extend({ chatId: id,
    blocks: z.array(z.object({ bodyHash: z.string().regex(/^[a-f0-9]{64}$/), blockId: id }).strict()).min(1).max(MESSAGE_CIPHER_LIMITS.rangeItems) }).strict(),
    result: z.object({ blocks: z.array(encryptedMessageBlockSchema).min(1).max(MESSAGE_CIPHER_LIMITS.rangeItems), complete: z.boolean() }).strict() },
  "chats/body/reads:recent": { kind: "query", args: header.extend({ fromInclusive: rev, throughInclusive: rev,
    cursor: z.string().max(4096).nullable(), revision: rev.nullable() }).strict().refine(value => value.throughInclusive >= value.fromInclusive && value.throughInclusive - value.fromInclusive <= 604_800_000),
    result: z.object({ items: z.array(z.union([encryptedMessageSchema, encryptedTurnPrefixSchema])).max(MESSAGE_CIPHER_LIMITS.rangeItems), cursor: z.string().max(4096).nullable(),
      complete: z.boolean(), revision: rev, invalidTimeCount: rev }).strict() },
} as const;
