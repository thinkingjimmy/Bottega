/**
 * [INPUT]: Depends on shared immutable App deletion operations/receipts and local scope identities.
 * [OUTPUT]: Defines the durable original App deletion request and its exact response or reviewed rejection.
 * [POS]: AppStore portable deletion custody; no local runtime authority or separate persistence file is introduced.
 */
import { z } from "zod";
import { appDeleteOperationSchema, appDeletionHash } from "@ai-chat/cloud-protocol/apps/deletion";
import { appReceiptSchema, appItemSchema } from "@ai-chat/cloud-protocol/apps/model";
import { portableProjectSchema } from "@ai-chat/cloud-protocol";
import { syncScopeSchema, storageIdSchema } from "../../../../../shared/local-storage/contracts";
import { frozenAppOperationSchema } from "@ai-chat/cloud-protocol/apps/encrypted";
import { verifyFrozenAppOperation } from "@ai-chat/cloud-protocol/apps/encrypted/client";
export const appDeletionRequestSchema = z.object({ scope: syncScopeSchema.nullable(), operation: appDeleteOperationSchema,
  projectId: storageIdSchema, baseId: storageIdSchema, attempts: z.number().int().nonnegative(),
  receipt: appReceiptSchema.nullable(), dismissed: z.boolean(),
  encryption: frozenAppOperationSchema.nullable().default(null),
  baseline: z.object({ app: appItemSchema, project: portableProjectSchema, baseRevision: z.number().int().nonnegative(),
    baseSchemaRevision: z.number().int().nonnegative() }).strict().optional(),
}).strict().refine(item => !item.baseline || item.baseline.app.appId === item.operation.appId &&
  item.baseline.app.projectId === item.projectId && item.baseline.app.baseId === item.baseId &&
  item.baseline.app.revision === item.operation.expectedRevision && item.baseline.project.id === item.projectId &&
  item.baseline.project.appId === item.operation.appId, "App deletion baseline identity changed")
  .refine(item => !item.receipt || item.receipt.kind === "delete" && item.receipt.operationId === item.operation.operationId &&
  item.receipt.appId === item.operation.appId && item.receipt.projectId === item.projectId && item.receipt.baseId === item.baseId &&
  item.receipt.payloadHash === appDeletionHash(item.operation), "App deletion receipt identity changed")
  .refine(item => !item.dismissed || item.receipt && ["blocked", "conflicted"].includes(item.receipt.outcome), "Unresolved deletion cannot be dismissed")
  .refine(item => { try { if (item.encryption) verifyFrozenAppOperation(item.encryption, item.operation); return true; } catch { return false; } }, "App deletion ciphertext changed");
export type AppDeletionRequest = z.infer<typeof appDeletionRequestSchema>;
