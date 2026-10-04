/**
 * [INPUT]: Depends on Zod, canonical JSON, the remote packet codec and the `remote-memory` AAD binding.
 * [OUTPUT]: Re-exports the R-33 Memory status (memory-status.ts) and provides seal/open helpers for its sealed per-computer packet, bound to the publishing computer, connection and protocol version.
 * [POS]: packages/cloud-protocol/src/remote/memory; remote/'s computer-level capability beside the per-Agent packets; the desktop publishes it only when the person turned the phone facade on, and the phone renders it verbatim (P13).
 */
import type { ProtocolHeader } from "../../config";
import { assertCrypto, createRemoteMemoryContext, type CryptoScope } from "../../encryption";
import { canonicalJson } from "../../encryption/encoding";
import { encryptedRemoteMemorySchema, type EncryptedRemoteMemory } from "../encrypted/model";
import { REMOTE_MEMORY_PLAINTEXT_BYTES, remoteMemoryStatusSchema, type RemoteMemoryStatus } from "./memory-status";
import { openRemotePacket, sealRemotePacket, type RemoteCipherPort } from "../encrypted/client";

export * from "./memory-status";

export function remoteMemoryContext(scope: CryptoScope, input: { deviceId: string; connectionEpoch: string; publicationId: string; protocolVersion: number }) {
  return createRemoteMemoryContext(scope, input.publicationId, input.publicationId, input);
}
export async function sealRemoteMemory(status: RemoteMemoryStatus, connectionEpoch: string, header: ProtocolHeader, crypto: RemoteCipherPort, signal?: AbortSignal) {
  const value = remoteMemoryStatusSchema.parse(status);
  if (new TextEncoder().encode(canonicalJson(value)).byteLength > REMOTE_MEMORY_PLAINTEXT_BYTES) throw new Error("remote-memory-budget");
  const publicationId = globalThis.crypto.randomUUID();
  const context = remoteMemoryContext(crypto.scope, { deviceId: crypto.session.deviceId, connectionEpoch, publicationId, protocolVersion: header.protocolVersion });
  return encryptedRemoteMemorySchema.parse({ publicationId, packet: await sealRemotePacket(crypto, context, value, signal) });
}
export async function openRemoteMemory(value: EncryptedRemoteMemory, target: { deviceId: string; connectionEpoch: string; protocolVersion: number },
  crypto: RemoteCipherPort, signal?: AbortSignal) {
  const sealed = encryptedRemoteMemorySchema.parse(value);
  const status = remoteMemoryStatusSchema.parse(await openRemotePacket(crypto, remoteMemoryContext(crypto.scope, { ...target, publicationId: sealed.publicationId }), sealed.packet, signal));
  assertCrypto(new TextEncoder().encode(canonicalJson(status)).byteLength <= REMOTE_MEMORY_PLAINTEXT_BYTES);
  return status;
}
