/**
 * [INPUT]: Depends on the main account transport, in-memory token provider and public file contracts.
 * [OUTPUT]: Provides scoped authenticated metadata and binary transfer ports.
 * [POS]: Desktop BlobStore transport; no bytes or credentials pass through renderer Convex connections.
 */
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { blobPartSchema, protocolHeader, readFileResponse, type BlobTransferPorts, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { AccountTransport } from "../runtime/transport";
export function desktopFileTransport(input: { config: CloudBuildConfig; userId: string; transport: Pick<AccountTransport, "query" | "mutate">;
  crypto(): FileCipherPort; token(): Promise<string | null>; fetch?: typeof fetch }): BlobTransferPorts {
  const request = input.fetch ?? fetch;
  const scope = () => {
    const crypto = input.crypto(); if (crypto.session.userId !== input.userId) throw new Error("file-scope-mismatch");
    return { ...protocolHeader(input.config), expectedUserId: input.userId, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  };
  async function part(method: "GET" | "POST", value: unknown, limit: number, signal: AbortSignal, body?: Uint8Array<ArrayBuffer>) {
    signal.throwIfAborted(); const token = await input.token(); signal.throwIfAborted(); if (!token) throw new Error("signed-out");
    const abort = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
    const response = await request(input.config.httpOrigin + "/api/files/part", { method, body, credentials: "omit", redirect: "error", signal: abort,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream", "X-Bottega-File": JSON.stringify(value) } });
    return readFileResponse(response, limit, abort);
  }
  return {
    crypto: input.crypto,
    begin: async (value, signal) => {
      signal.throwIfAborted();
      if (value.expectedUserId !== scope().expectedUserId || value.environmentId !== scope().environmentId || value.deploymentId !== scope().deploymentId) throw new Error("file-scope-mismatch");
      return input.transport.mutate("blobs/api:begin", value);
    },
    status: (uploadId, signal) => { signal.throwIfAborted(); return input.transport.query("blobs/api:status", { ...scope(), uploadId }); },
    finalize: (uploadId, signal) => { signal.throwIfAborted(); return input.transport.mutate("blobs/api:finalize", { ...scope(), uploadId }); },
    cancel: uploadId => input.transport.mutate("blobs/api:cancel", { ...scope(), uploadId }),
    readPlan: (blobId, owner, signal) => { signal.throwIfAborted(); return input.transport.query("blobs/transfer/reads:plan", { ...scope(), blobId, owner }); },
    sendPart: async (uploadId, item, bytes, signal) => blobPartSchema.parse(JSON.parse(new TextDecoder().decode(await part("POST",
      { ...scope(), uploadId, partIndex: item.partIndex, sha256: item.sha256 }, 4096, signal, bytes)))),
    readPart: (plan, item, signal) => part("GET", { ...scope(), blobId: plan.descriptor.blobId, owner: plan.owner, locationId: plan.locationId,
      locationRevision: plan.locationRevision, expiresAt: plan.expiresAt, partIndex: item.partIndex }, item.bytes, signal),
  };
}
