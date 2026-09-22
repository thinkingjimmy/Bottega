/**
 * [INPUT]: Depends on Zod and portable identity/revision primitives.
 * [OUTPUT]: Provides completion metadata and immutable live-turn settlement contracts.
 * [POS]: Shared terminal evidence codec; empty outcomes remain explicit and sequence identities cannot be reused.
 */
import { z } from "zod";
import { cloudIdSchema as storageIdSchema } from "../../auth";
import { versionSchema as storageRevisionSchema } from "../../scalars";
const storageHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const completionFields = {
  turnId: storageIdSchema.optional(),
  completion: z.enum(["complete", "interrupted"]).optional(),
  completionReason: z.enum(["execution-unconfirmed", "final-result-missing", "source-error", "source-cancelled"]).optional(),
  resultHash: storageHashSchema.optional(),
};
export const completionMetadataSchema = z.object(completionFields);
export type CompletionMetadata = z.infer<z.ZodObject<typeof completionFields>>;
export const turnReceiptSchema = z.object({
  chatId: storageIdSchema,
  incarnationId: storageIdSchema,
  turnId: storageIdSchema,
  ownerDeviceId: storageIdSchema,
  userMessageId: storageIdSchema,
  userSeq: storageRevisionSchema.positive(),
  assistantMessageId: storageIdSchema,
  assistantSeq: storageRevisionSchema.positive(),
  identityHash: storageHashSchema,
  settlementState: z.enum(["open", "sealing", "settled"]),
  sealedHighSeq: storageRevisionSchema.optional(),
  sealReason: z.enum(["device-revoked", "replaced", "unknown-timeout", "final-result-missing"]).optional(),
  terminalKind: z.enum(["done", "error", "cancelled"]).optional(),
  resultKind: z.enum(["message", "empty"]).optional(),
  finalMessageId: storageIdSchema.optional(),
  resultHash: storageHashSchema.optional(),
  settledAt: storageRevisionSchema.optional(),
}).strict().refine(value => value.assistantSeq === value.userSeq + 1 &&
  (value.settlementState !== "settled" || Boolean(value.resultKind && value.resultHash && value.settledAt !== undefined)) &&
  (value.resultKind !== "message" || value.finalMessageId === value.assistantMessageId) &&
  (value.resultKind !== "empty" || value.finalMessageId === undefined),
{ error: "Invalid turn settlement" });
export type CloudTurnReceipt = z.infer<typeof turnReceiptSchema>;
