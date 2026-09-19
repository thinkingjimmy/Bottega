/**
 * [INPUT]: Closed Chat routing facts, App promotion bundles and immutable encrypted-space identities.
 * [OUTPUT]: Ciphertext classification CAS operations, frozen original-hash mappings and receipts.
 * [POS]: Classification wire schema; names and original payload/candidate hashes remain encrypted.
 */
import { z } from "zod";
import { id, digest, version } from "../../../encryption/domains/scalars";
import { encryptedSpaceSchema } from "../../../spaces";
import { classificationSchema, portableChatSchema } from "../../model";
import { basePromotionProofSchema } from "../../../apps/promotion";
import { appIdSchema } from "../../../apps/model";
import { encryptedAppPromotionSchema } from "../../../apps/encrypted/promotion";
import { projectPacketSchema } from "../../../projects/encrypted";
import { chatPacketSchema, encryptedChatHeadSchema } from "../model";
const classificationPromotionSchema = z.object({ baseId: id, expectedRevision: version,
  destination: z.discriminatedUnion("kind", [z.object({ kind: z.literal("project"), projectId: id }).strict(),
    z.object({ kind: z.literal("app"), projectId: id, appId: appIdSchema }).strict()]) }).strict();
export const classificationIntentSchema = z.object({ incarnationId: id, expectedRevision: version.positive(), executionEpoch: version.positive(),
  previous: classificationSchema, next: classificationSchema, basePromotion: classificationPromotionSchema.nullable(),
  projectRescue: z.object({ projectId: id }).strict().nullable(), sourceDeviceId: id,
  agent: portableChatSchema.shape.agent, agentRevision: version, createdAt: version, archivedAt: version.nullable() }).strict()
  .refine(value => !value.projectRescue || !value.basePromotion && value.previous.projectId === value.projectRescue.projectId &&
    value.next.conversationKind === "ordinary" && value.next.projectId === null && value.next.appId === null);
export const encryptedClassificationOperationSchema = z.object({ lifecycleOperationId: id, chatId: id, intent: classificationIntentSchema,
  facts: chatPacketSchema, app: encryptedAppPromotionSchema.nullable(), operation: projectPacketSchema, ciphertextHash: digest }).strict()
  .refine(value => (value.intent.basePromotion?.destination.kind === "app") === (value.app !== null));
export const encryptedClassificationReceiptSchema = z.object({ lifecycleOperationId: id, chatId: id, ciphertextHash: digest,
  expectedRevision: version.positive(), status: z.enum(["applied", "conflicted", "fenced", "deleted"]), head: encryptedChatHeadSchema.nullable(),
  sourceDeviceId: id, createdAt: version, basePromotion: basePromotionProofSchema.optional(), commit: encryptedClassificationOperationSchema }).strict()
  .refine(value => (value.status === "deleted") === (value.head === null));
export const frozenClassificationSchema = z.object({ kind: z.literal("encrypted-chat-classification"), encryptedSpace: encryptedSpaceSchema,
  plaintextHash: digest, candidateHash: digest, transport: encryptedClassificationOperationSchema }).strict();
export type EncryptedClassificationOperation = z.infer<typeof encryptedClassificationOperationSchema>;
export type EncryptedClassificationReceipt = z.infer<typeof encryptedClassificationReceiptSchema>;
export type FrozenClassification = z.infer<typeof frozenClassificationSchema>;
