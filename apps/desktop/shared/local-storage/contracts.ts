/**
 * [INPUT]: Depends on Zod and canonical Agent options.
 * [OUTPUT]: Provides strict scope, portable classification, blob, mirror and turn receipt contracts.
 * [POS]: Shared storage boundary; none of these facts grants local execution authority.
 */
import { z } from "zod";
import { agentBackendIdSchema } from "../agent-schema";
import { turnOptionsSchema } from "../chat-agent/options";

export const storageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const storageHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const storageRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const syncScopeSchema = z.object({
  environment: storageIdSchema,
  userId: storageIdSchema,
}).strict();
export type SyncScope = z.infer<typeof syncScopeSchema>;
export const storageModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local-only") }).strict(),
  z.object({ kind: z.literal("fixture"), scope: syncScopeSchema }).strict(),
  z.object({ kind: z.literal("snapshot-initialization"), scope: syncScopeSchema }).strict(),
]);
export type StorageMode = z.infer<typeof storageModeSchema>;
export const classificationSchema = z.object({
  conversationKind: z.enum(["ordinary", "app-use", "app-edit"]),
  appId: storageIdSchema.nullable(),
  projectId: storageIdSchema.nullable(),
}).strict().refine(value =>
  (value.conversationKind === "ordinary") === (value.appId === null) &&
  (value.conversationKind !== "app-edit" || value.projectId !== null),
{ error: "Invalid portable Chat classification" });
export type ChatClassification = z.infer<typeof classificationSchema>;
export function projectChatClassification(record: {
  projectId: string | null;
  context: { kind: "ordinary" } | { kind: "app-use"; appId: string } |
    { kind: "app-edit"; appId: string; projectId: string };
}): ChatClassification {
  const context = record.context;
  if (context.kind === "app-edit" && context.projectId !== record.projectId) {
    throw new Error("Chat context and Project membership disagree");
  }
  return classificationSchema.parse({
    conversationKind: context.kind,
    appId: context.kind === "ordinary" ? null : context.appId,
    projectId: record.projectId,
  });
}
export const logicalBlobSchema = z.object({
  blobId: z.string().regex(/^[A-Za-z0-9_.-]{1,192}$/),
  sha256: storageHashSchema,
  bytes: storageRevisionSchema,
  mime: z.string().min(1).max(128),
}).strict();
export type LogicalBlob = z.infer<typeof logicalBlobSchema>;
export const portableChatSchema = z.object({
  id: storageIdSchema,
  incarnationId: storageIdSchema,
  title: z.string().trim().min(1).max(200).nullable(),
  agent: agentBackendIdSchema,
  options: turnOptionsSchema,
  agentRevision: storageRevisionSchema,
  classification: classificationSchema,
  cloudRevision: storageRevisionSchema,
  createdAt: storageRevisionSchema,
  updatedAt: storageRevisionSchema,
}).strict().refine(value => value.agent === value.options.backend && value.updatedAt >= value.createdAt,
  { error: "Invalid portable Chat facts" });
export type PortableChat = z.infer<typeof portableChatSchema>;
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
  executionEpoch: storageRevisionSchema,
  executorDeviceId: storageIdSchema,
  userMessageId: storageIdSchema,
  userSeq: storageRevisionSchema.positive(),
  assistantMessageId: storageIdSchema,
  assistantSeq: storageRevisionSchema.positive(),
  identityHash: storageHashSchema,
  settlementState: z.enum(["open", "sealing", "settled"]),
  sealedHighSeq: storageRevisionSchema.optional(),
  sealReason: z.enum(["executor-changed", "device-revoked", "replaced", "unknown-timeout", "final-result-missing"]).optional(),
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
export function sameScope(left: SyncScope | null, right: SyncScope | null) {
  return Boolean(left && right && left.environment === right.environment && left.userId === right.userId);
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("Storage values must be JSON");
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) =>
      `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
