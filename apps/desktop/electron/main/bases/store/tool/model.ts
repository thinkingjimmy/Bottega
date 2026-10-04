/**
 * [INPUT]: Depends on canonical storage identities and synchronization scopes.
 * [OUTPUT]: Provides generation-bound Agent batch item receipts without retaining duplicate cell values.
 * [POS]: BaseStore tool provenance embedded in its existing synchronization envelope.
 */
import { z } from "zod";
import { storageIdSchema, syncScopeSchema } from "../../../../../shared/local-storage/contracts";

export const toolBatchReceiptSchema = z.object({
  operationId: storageIdSchema,
  batchId: storageIdSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  scope: syncScopeSchema.nullable(),
  targets: z.array(z.string().min(1).max(384)).max(512),
  status: z.enum(["saved", "rejected", "conflicted"]),
  reason: z.string().max(256).nullable(),
  cloudOperation: z.boolean(),
  revision: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative().max(10000),
}).strict();
export type BaseToolReceipt = z.infer<typeof toolBatchReceiptSchema>;
export type BaseToolIdentity = Pick<BaseToolReceipt, "operationId" | "batchId" | "requestHash"> & { targets?: string[] };
