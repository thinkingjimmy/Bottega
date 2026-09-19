/**
 * [INPUT]: Cloud transport failures and the shared RemoteReason contract.
 * [OUTPUT]: Separates retryable transport failures from structured admission rejections.
 * [POS]: Command boundary shared by intake authority and original control validation.
 */
import { ConvexError } from "convex/values";
import { remoteReasonSchema } from "@ai-chat/cloud-protocol/remote/model";
export class RemoteTransportFailure extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : "remote-transport-unavailable", { cause }); }
}
export async function remoteRequest<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (error) {
    const reason = remoteReasonSchema.safeParse(error instanceof ConvexError ? error.data : error instanceof Error ? error.message : error);
    if (reason.success) throw new Error(reason.data);
    throw new RemoteTransportFailure(error);
  }
}
