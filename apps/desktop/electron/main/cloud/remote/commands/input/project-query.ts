/**
 * [INPUT]: Original scoped query, native Project workspace resolver and current connection/feature authority.
 * [OUTPUT]: Encrypted bounded relative candidates, rechecking binding and account after asynchronous reads.
 * [POS]: Pure query target adapter; it never creates a Chat, grants files or invokes an Agent.
 */
import { z } from "zod";
import type { CloudFunctionArgs, CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { assertCrypto, assertExpectedScope } from "@ai-chat/cloud-protocol/encryption";
import { projectQueryContext, projectQueryResultSchema } from "@ai-chat/cloud-protocol/remote/workspace/model";
import { openRemotePacket, sealRemotePacket, type RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import type { RemoteWorkspaceService } from "./references";
export async function answerProjectQuery(row: CloudFunctionResult<"remote/workspace:inbox">[number], ports: {
  workspace: RemoteWorkspaceService; crypto: RemoteCipherPort; deviceId: string; connectionEpoch: string; current(): void;
  report(input: Omit<CloudFunctionArgs<"remote/workspace:report">, "environmentId" | "deploymentId" | "protocolVersion" | "expectedUserId" | "encryptedSpace">): Promise<null>;
}) {
  ports.current(); const request = row.request, b = request.binding;
  assertExpectedScope(row.encryptedSpace.scope, ports.crypto.scope);
  assertCrypto(row.encryptedSpace.keyPackageFingerprint === ports.crypto.keyPackageFingerprint && b.targetDeviceId === ports.deviceId &&
    b.connectionEpoch === ports.connectionEpoch && b.requestHash === null);
  const query = z.object({ query: z.string().max(256) }).strict().parse(await openRemotePacket(ports.crypto, projectQueryContext(ports.crypto.scope, request), request.packet));
  ports.current();
  let result;
  try { result = await ports.workspace.project(b.projectId, query.query, ports.current); }
  catch { ports.current(); result = { kind: "unavailable", reason: "workspace-file-unavailable" }; }
  const packet = await sealRemotePacket(ports.crypto, projectQueryContext(ports.crypto.scope, request, request.packet.ciphertextHash), projectQueryResultSchema.parse(result));
  ports.current(); await ports.report({ queryId: request.queryId, connectionEpoch: ports.connectionEpoch, result: packet }); ports.current();
}
