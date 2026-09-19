/**
 * [INPUT]: Scoped RPC transport, admitted crypto, calibrated clock and selected Project/computer.
 * [OUTPUT]: Abortable encrypted candidate query without creating a Chat, exposing paths or granting execution.
 * [POS]: Shared native/browser pre-Chat reference port; exact packets remain stable through polling.
 */
import type { z } from "zod";
import type { CloudFunctionArgs, CloudFunctionResult } from "../../index";
import type { RemoteCipherPort } from "../encrypted/client";
import type { ServerClock } from "../../continuity/clock";
import { sealRemotePacket, openRemotePacket } from "../encrypted/client";
import { assertCrypto, assertExpectedScope } from "../../encryption";
import { canonicalJson } from "../../encryption/encoding";
import { projectQueryInputSchema, projectQueryResultSchema, projectQueryContext } from "./model";
export async function queryProjectFiles(input: z.infer<typeof projectQueryInputSchema>, ports: {
  crypto: RemoteCipherPort; clock: ServerClock; protocolVersion: number; connectionEpoch: string; current(): void;
  submit(request: CloudFunctionArgs<"remote/workspace:submit">["request"]): Promise<null>;
  get(queryId: string): Promise<CloudFunctionResult<"remote/workspace:get">>;
}, signal: AbortSignal) {
  const value = projectQueryInputSchema.parse(input), queryId = crypto.randomUUID(), expiresAt = await ports.clock.freezeDeadline("list-workspace-files");
  const binding = { sourceDeviceId: ports.crypto.session.deviceId, targetDeviceId: value.targetDeviceId, projectId: value.projectId,
    connectionEpoch: ports.connectionEpoch, protocolVersion: ports.protocolVersion, expiresAt, requestHash: null };
  ports.current(); signal.throwIfAborted();
  const request = { queryId, binding, packet: await sealRemotePacket(ports.crypto, projectQueryContext(ports.crypto.scope, { queryId, binding }), { query: value.query }, signal) };
  await ports.submit(request); ports.current();
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    signal.throwIfAborted(); const receipt = await ports.get(queryId); ports.current(); signal.throwIfAborted();
    if (!receipt) throw new Error("workspace-file-unavailable");
    assertExpectedScope(receipt.encryptedSpace.scope, ports.crypto.scope);
    assertCrypto(receipt.encryptedSpace.keyPackageFingerprint === ports.crypto.keyPackageFingerprint && canonicalJson(receipt.request) === canonicalJson(request));
    if (receipt.result) {
      const result = projectQueryResultSchema.parse(await openRemotePacket(ports.crypto,
        projectQueryContext(ports.crypto.scope, request, request.packet.ciphertextHash), receipt.result, signal));
      ports.current(); signal.throwIfAborted();
      if (result.kind === "unavailable") throw new Error(result.reason);
      assertCrypto(result.deviceId === value.targetDeviceId); return result;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 300);
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    });
  }
  throw new Error("command-expired");
}
