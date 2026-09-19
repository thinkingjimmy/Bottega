/**
 * [INPUT]: Fixed v2 AAD constructors, canonical closed routing metadata and ciphertext packets.
 * [OUTPUT]: Exact remote command/result/capability/creation validation and deterministic scoped allocation.
 * [POS]: Pure remote wire integrity; trusted current authorization and TTL checks remain server transactions.
 */
import { hashCanonical } from "../../encryption/encoding";
import { assertCrypto, assertExpectedContext, createRemoteIntentContext, createRemoteCommandContext, createRemoteCreationContext, createRemoteResultContext,
  decodeBase64url, hashEnvelope, parseEnvelope, type CryptoContext, type CryptoScope } from "../../encryption";
import { remoteCommandBindingSchema } from "../../encryption/domains/streams";
import { encryptedRemoteCommandSchema, encryptedRemoteCreationSchema, remoteCommandHeaderSchema, remotePacketSchema, REMOTE_CIPHER_LIMITS,
  type EncryptedRemoteCommand, type EncryptedRemoteCreation, type EncryptedRemoteReport, type RemotePacket } from "./model";
export const remoteHash = hashCanonical;
function remoteCommandHeader(command: EncryptedRemoteCommand) {
  const { packet: _packet, ciphertextHash: _hash, ...header } = command;
  return remoteCommandHeaderSchema.parse(header);
}
function commandBinding(command: EncryptedRemoteCommand) {
  const { intent: _intent, commandId: _id, interactionId: _interaction, backend: _backend, environmentId: _environment, deploymentId: _deployment, ...binding } = remoteCommandHeader(command);
  return remoteCommandBindingSchema.parse(binding);
}
export function remoteCommandContext(scope: CryptoScope, command: EncryptedRemoteCommand) {
  if (command.intent) return createRemoteIntentContext(scope, command.commandId, command.commandId, {
    chatId: command.chatId, incarnationId: command.incarnationId, sourceDeviceId: command.sourceDeviceId,
    intentId: command.commandId, intendedTargetDeviceId: command.targetDeviceId, intentExpiresAt: command.intent.expiresAt });
  return createRemoteCommandContext(scope, command.commandId, remoteHash(remoteCommandHeader(command)), commandBinding(command));
}
export function remoteResultContext(scope: CryptoScope, command: EncryptedRemoteCommand, report: Pick<EncryptedRemoteReport, "revision" | "state" | "admission" | "blockedBy" | "noAdmission">) {
  return createRemoteResultContext(scope, command.commandId, remoteHash({ header: remoteCommandHeader(command), report }),
    { ...commandBinding(command), commandCiphertextHash: command.ciphertextHash, resultRevision: report.revision, state: report.state });
}
export function validateRemotePacket(context: CryptoContext, raw: RemotePacket) {
  const packet = remotePacketSchema.parse(raw), bytes = decodeBase64url(packet.envelope, 1, REMOTE_CIPHER_LIMITS.packetBytes);
  assertCrypto(bytes.byteLength === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, context); return bytes;
}
export function validateRemoteCommand(scope: CryptoScope, raw: EncryptedRemoteCommand) {
  const value = encryptedRemoteCommandSchema.parse(raw);
  validateRemotePacket(remoteCommandContext(scope, value), value.packet);
  assertCrypto(value.ciphertextHash === value.packet.ciphertextHash); return value;
}
export function remoteCreationContext(scope: CryptoScope, creation: Pick<EncryptedRemoteCreation, "createOperationId" | "binding">) {
  return createRemoteCreationContext(scope, creation.createOperationId, creation.createOperationId, creation.binding);
}
export function validateRemoteCreation(scope: CryptoScope, raw: EncryptedRemoteCreation) {
  const value = encryptedRemoteCreationSchema.parse(raw); validateRemotePacket(remoteCreationContext(scope, value), value.packet);
  assertCrypto(value.ciphertextHash === value.packet.ciphertextHash); return value;
}
export function remoteCreationIdentity(scope: CryptoScope, createOperationId: string) {
  const identity = (kind: string) => remoteHash({ schema: "bottega.remote-allocation/v1", scope, createOperationId, kind });
  return { chatId: identity("chat").slice(0, 32), incarnationId: identity("incarnation").slice(0, 32) };
}
export function remoteCapabilityContext(scope: CryptoScope, input: { deviceId: string; connectionEpoch: string; protocolVersion: number;
  publicationId: string; backend: "claude" | "codex" | "opencode" | "kimi"; available: boolean; reason: string | null }) {
  const identity = "capability:" + remoteHash(input);
  return createRemoteCreationContext(scope, identity, identity, { sourceDeviceId: input.deviceId, targetDeviceId: input.deviceId,
    connectionEpoch: input.connectionEpoch, agent: input.backend, expectedAgentRevision: 0, projectId: null, protocolVersion: input.protocolVersion, createdAt: 0 });
}
