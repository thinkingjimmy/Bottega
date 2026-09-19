/**
 * [INPUT]: Depends on stable turn/invocation facts and canonical hashing.
 * [OUTPUT]: Provides deterministic batch and suboperation identities across lease reissue and restart.
 * [POS]: Main-only Agent Base request identity; no renderer or model supplied cloud identity is trusted.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import type { BuiltinToolContext } from "../../../tools/registry";

export const toolHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function baseToolKey(context: BuiltinToolContext, batchId?: string) {
  return batchId ?? toolHash([context.lease.chatId, context.lease.incarnationId, context.lease.requestId, context.invocationId]);
}
export function baseToolBatch(context: BuiltinToolContext, ownerInstanceId: string, tool: string, batchId?: string) {
  return toolHash(["base-tool", ownerInstanceId, tool, baseToolKey(context, batchId)]);
}
export function baseToolItem(batchId: string, itemId: string, request: unknown) {
  return { batchId, operationId: toolHash([batchId, itemId]), requestHash: toolHash(request) };
}
