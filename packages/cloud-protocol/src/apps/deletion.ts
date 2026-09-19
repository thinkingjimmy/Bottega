/**
 * [INPUT]: Depends on immutable App deletion operations, canonical hashes and authorized receipt/apply ports.
 * [OUTPUT]: Provides exact deletion receipt validation and original-request delivery shared by desktop and Web.
 * [POS]: Pure App lifecycle transport kernel; persistence and account ownership remain with each platform.
 */
import { appOperationSchema, appReceiptSchema, type AppReceipt } from "./model";
import { canonicalJson } from "../encryption/encoding";
import { hashBytes } from "../blobs/transfer";
import type { z } from "zod";
export const appDeleteOperationSchema = appOperationSchema.options[2];
export type AppDeleteOperation = z.infer<typeof appDeleteOperationSchema>;
export function appDeletionHash(input: AppDeleteOperation) {
  return hashBytes(new TextEncoder().encode(canonicalJson(appDeleteOperationSchema.parse(input))));
}
function validateAppDeletionReceipt(operation: AppDeleteOperation, input: AppReceipt) {
  const receipt = appReceiptSchema.parse(input);
  if (receipt.kind !== "delete" || receipt.operationId !== operation.operationId || receipt.appId !== operation.appId ||
    receipt.payloadHash !== appDeletionHash(operation)) throw new Error("APP_DELETION_RECEIPT_CHANGED");
  return receipt;
}
export async function deliverAppDeletion(operation: AppDeleteOperation, ports: {
  receipt(operationId: string): Promise<AppReceipt | null>;
  apply(operation: AppDeleteOperation): Promise<AppReceipt>;
  current(): void;
}) {
  const frozen = Object.freeze(appDeleteOperationSchema.parse(operation));
  ports.current(); const known = await ports.receipt(frozen.operationId); ports.current();
  const receipt = known ?? await ports.apply(frozen); ports.current();
  return validateAppDeletionReceipt(frozen, receipt);
}
