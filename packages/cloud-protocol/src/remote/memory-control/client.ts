/**
 * [INPUT]: Memory control contracts, domain-separated purpose-10/11 bindings and the shared content cipher.
 * [OUTPUT]: Strict target-only execution and sender-only intent reads, plus result sealing/opening bound to both devices, CAS revision and request ciphertext.
 * [POS]: Shared desktop/Web Memory control codec; application timestamps remain encrypted desktop facts.
 */
import { PROTOCOL_VERSION } from "../../config";
import { assertCrypto, assertExpectedScope, createMemoryControlContext, createMemoryControlResultContext, type CryptoScope } from "../../encryption";
import { sealRemotePacket, openRemotePacket, type RemoteCipherPort } from "../encrypted/client";
import { validateRemotePacket } from "../encrypted/wire";
import { memoryControlBodySchema, memoryControlHeaderSchema, memoryControlRequestSchema, memoryControlResultSchema,
  type MemoryControlReceipt, type MemoryControlRequest, type MemoryControlResult } from "./model";
const binding = (request: MemoryControlRequest) => ({ sourceDeviceId: request.sourceDeviceId, targetDeviceId: request.targetDeviceId,
  revision: request.revision, protocolVersion: request.protocolVersion });
export const memoryControlContext = (scope: CryptoScope, request: MemoryControlRequest) => createMemoryControlContext(scope, request.requestId, request.requestId, binding(request));
export const memoryControlResultContext = (scope: CryptoScope, request: MemoryControlRequest, state: "applied" | "refused") =>
  createMemoryControlResultContext(scope, request.requestId, request.requestId, { ...binding(request), requestHash: request.packet.ciphertextHash, state });
export async function prepareMemoryControl(input: { requestId: string; sourceDeviceId: string; targetDeviceId: string; revision: number; paused: boolean }, crypto: RemoteCipherPort) {
  const { paused, ...values } = input, header = memoryControlHeaderSchema.parse({ ...values, protocolVersion: PROTOCOL_VERSION });
  assertCrypto(header.sourceDeviceId === crypto.session.deviceId);
  const packet = await sealRemotePacket(crypto, memoryControlContext(crypto.scope, header as MemoryControlRequest), memoryControlBodySchema.parse({ paused }));
  return memoryControlRequestSchema.parse({ ...header, packet });
}
export async function openMemoryControl(receipt: MemoryControlReceipt, crypto: RemoteCipherPort) {
  assertExpectedScope(receipt.encryptedSpace.scope, crypto.scope);
  assertCrypto(receipt.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint && receipt.request.targetDeviceId === crypto.session.deviceId);
  const request = memoryControlRequestSchema.parse(receipt.request);
  return memoryControlBodySchema.parse(await openRemotePacket(crypto, memoryControlContext(crypto.scope, request), request.packet));
}
/** The sending device may recover only its own encrypted request after a route/browser reload. */
export async function openSentMemoryControlIntent(receipt: MemoryControlReceipt, crypto: RemoteCipherPort) {
  assertExpectedScope(receipt.encryptedSpace.scope, crypto.scope);
  assertCrypto(receipt.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint && receipt.request.sourceDeviceId === crypto.session.deviceId);
  const request = memoryControlRequestSchema.parse(receipt.request);
  return memoryControlBodySchema.parse(await openRemotePacket(crypto, memoryControlContext(crypto.scope, request), request.packet));
}
export async function prepareMemoryControlResult(request: MemoryControlRequest, result: MemoryControlResult, crypto: RemoteCipherPort) {
  const body = memoryControlResultSchema.parse(result);
  assertCrypto(request.targetDeviceId === crypto.session.deviceId);
  return sealRemotePacket(crypto, memoryControlResultContext(crypto.scope, request, body.kind), body);
}
export async function openMemoryControlResult(receipt: MemoryControlReceipt, crypto: RemoteCipherPort): Promise<MemoryControlResult | null> {
  if (!receipt.result || (receipt.state !== "applied" && receipt.state !== "refused")) return null;
  assertExpectedScope(receipt.encryptedSpace.scope, crypto.scope);
  assertCrypto(receipt.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const context = memoryControlResultContext(crypto.scope, receipt.request, receipt.state);
  validateRemotePacket(context, receipt.result);
  const body = memoryControlResultSchema.parse(await openRemotePacket(crypto, context, receipt.result));
  assertCrypto(body.kind === receipt.state); return body;
}
