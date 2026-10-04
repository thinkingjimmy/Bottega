/**
 * [INPUT]: Depends on the pure envelope parser/hash, the purpose-10/11 context constructors, canonical JSON, a content cipher port and the resource-command model.
 * [OUTPUT]: Provides validateResourceCommand / validateResourceResult (server-safe, AAD against the header), sealResourceCommand (a header as given) and prepareResourceCommand (class, criticality and expiry derived from the action), openResourceCommand (the owner's read: body, and whether the header's class matches the action), prepareResourceResult and openResourceResult.
 * [POS]: Resource-command codec (§10.1). A command re-addressed to another device or resource, or a result moved to another command, fails AEAD.
 */
import { canonicalJson } from "../encryption/encoding";
import { assertCrypto, assertExpectedContext, assertExpectedScope, createResourceCommandContext, createResourceResultContext, decodeBase64url, encodeBase64url,
  hashEnvelope, parseEnvelope, type CryptoScope, type DomainContext } from "../encryption";
import type { FileCipherPort } from "../blobs/encrypted/model";
import { PROTOCOL_VERSION } from "../config";
import { encryptedResourceCommandSchema, encryptedResourceResultSchema, RESOURCE_CONTRACT, RESOURCE_LIMITS, resourceActionDescriptor, resourceActionKind, resourceCommandBodySchema,
  resourceResultBodySchema, type EncryptedResourceCommand, type EncryptedResourceResult, type ResourceAction, type ResourceActionInput, type ResourceCommandBody,
  type ResourceCommandHeader, type ResourceReceipt, type ResourceResultBody } from "./model";

type Packet = { envelope: string; ciphertextHash: string; ciphertextBytes: number };
const binding = (h: ResourceCommandHeader) => ({ protocolVersion: h.protocolVersion, sourceDeviceId: h.sourceDeviceId, targetDeviceId: h.targetDeviceId,
  resourceKind: h.resourceKind, resourceId: h.resourceId, commandClass: h.class, critical: h.critical, expiresAt: h.expiresAt });
const commandContext = (scope: CryptoScope, h: ResourceCommandHeader) => createResourceCommandContext(scope, h.commandId, h.commandId, binding(h));
const resultContext = (scope: CryptoScope, h: ResourceCommandHeader, commandCiphertextHash: string, result: Pick<EncryptedResourceResult, "revision" | "state">) =>
  createResourceResultContext(scope, h.commandId, h.commandId, { ...binding(h), commandCiphertextHash, resultRevision: result.revision, state: result.state });
const headerOf = (value: ResourceCommandHeader): ResourceCommandHeader => ({ commandId: value.commandId, sourceDeviceId: value.sourceDeviceId, targetDeviceId: value.targetDeviceId,
  protocolVersion: value.protocolVersion, resourceKind: value.resourceKind, resourceId: value.resourceId, class: value.class, critical: value.critical,
  createdAt: value.createdAt, expiresAt: value.expiresAt });

function check(packet: Packet, envelopeLimit: number, expected: DomainContext) {
  const bytes = decodeBase64url(packet.envelope, 1, envelopeLimit);
  assertCrypto(bytes.length === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, expected);
}
async function seal(context: DomainContext, value: unknown, crypto: FileCipherPort, limit: number) {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    if (plaintext.byteLength > limit) throw new Error("resource-command-budget");
    const sealed = await crypto.run({ kind: "encrypt", context, plaintext }, undefined, { priority: "foreground" });
    assertCrypto(sealed.kind === "encrypted");
    return { envelope: encodeBase64url(sealed.envelope), ciphertextHash: sealed.ciphertextHash, ciphertextBytes: sealed.envelope.byteLength };
  } finally { plaintext.fill(0); }
}
async function open(space: { scope: CryptoScope; keyPackageFingerprint: string }, packet: Packet, expectedContext: DomainContext, envelopeLimit: number, crypto: FileCipherPort) {
  assertExpectedScope(space.scope, crypto.scope);
  assertCrypto(space.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const opened = await crypto.run({ kind: "decrypt", expectedContext, envelope: decodeBase64url(packet.envelope, 1, envelopeLimit) });
  assertCrypto(opened.kind === "decrypted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext)) as unknown; }
  catch { assertCrypto(false); }
  finally { opened.plaintext.fill(0); }
}

export function validateResourceCommand(input: EncryptedResourceCommand) {
  const record = encryptedResourceCommandSchema.parse(input);
  check(record.packet, RESOURCE_LIMITS.commandEnvelopeBytes, commandContext(record.encryptedSpace.scope, record));
  return record;
}
/** Seals a body under a header exactly as given; prepareResourceCommand is the sender's path. */
export async function sealResourceCommand(header: ResourceCommandHeader, body: ResourceCommandBody, crypto: FileCipherPort): Promise<EncryptedResourceCommand> {
  const packet = await seal(commandContext(crypto.scope, header), body, crypto, 8_192);
  return validateResourceCommand({ ...headerOf(header), encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, packet });
}
/** The sender's command: class and criticality from the registry, expiry from the class. */
export async function prepareResourceCommand<A extends ResourceAction>(input: { commandId?: string; sourceDeviceId: string; targetDeviceId: string;
  resourceKind: ReturnType<typeof resourceActionKind>; resourceId: string; action: A; input: ResourceActionInput<A>; now: number }, crypto: FileCipherPort) {
  const descriptor = resourceActionDescriptor(input.resourceKind, input.action);
  if (!descriptor) throw new Error("resource-action-unknown");
  const body = resourceCommandBodySchema.parse({ contract: RESOURCE_CONTRACT, action: input.action, input: input.input }) as ResourceCommandBody;
  return sealResourceCommand({ commandId: input.commandId ?? globalThis.crypto.randomUUID(), sourceDeviceId: input.sourceDeviceId, targetDeviceId: input.targetDeviceId,
    protocolVersion: PROTOCOL_VERSION, resourceKind: input.resourceKind, resourceId: input.resourceId, class: descriptor.class, critical: descriptor.critical,
    createdAt: input.now, expiresAt: input.now + RESOURCE_LIMITS.ttlMs[descriptor.class] }, body, crypto);
}
/**
 * The owner's read, addressed to itself. `classMatches` is false when the header's class or criticality is not the action's
 * (R24-1): the owner refuses it without acting. A body no action accepts throws (R24-6).
 */
export async function openResourceCommand(raw: EncryptedResourceCommand, expected: { targetDeviceId: string }, crypto: FileCipherPort) {
  const record = validateResourceCommand(raw);
  assertCrypto(record.targetDeviceId === expected.targetDeviceId);
  const body = resourceCommandBodySchema.parse(await open(record.encryptedSpace, record.packet, commandContext(crypto.scope, { ...record, targetDeviceId: expected.targetDeviceId }),
    RESOURCE_LIMITS.commandEnvelopeBytes, crypto)) as ResourceCommandBody;
  const descriptor = resourceActionDescriptor(record.resourceKind, body.action);
  return { header: headerOf(record), body, classMatches: descriptor !== null && descriptor.class === record.class && descriptor.critical === record.critical };
}

export function validateResourceResult(command: Pick<EncryptedResourceCommand, keyof ResourceCommandHeader | "encryptedSpace"> & { ciphertextHash: string }, input: EncryptedResourceResult) {
  const result = encryptedResourceResultSchema.parse(input);
  if (result.packet) check(result.packet, RESOURCE_LIMITS.resultEnvelopeBytes, resultContext(command.encryptedSpace.scope, command, command.ciphertextHash, result));
  return result;
}
/** The owner's answer, bound to the command's ciphertext, the revision and the state it reports. */
export async function prepareResourceResult(command: EncryptedResourceCommand, input: { revision: number; state: EncryptedResourceResult["state"]; body: ResourceResultBody | null },
  crypto: FileCipherPort): Promise<EncryptedResourceResult> {
  const body = input.body === null ? null : resourceResultBodySchema.parse(input.body);
  const packet = body === null ? null
    : await seal(resultContext(crypto.scope, command, command.packet.ciphertextHash, input), body, crypto, 8_192);
  return validateResourceResult({ ...command, ciphertextHash: command.packet.ciphertextHash }, { revision: input.revision, state: input.state, packet });
}
/** The sender's read of a receipt's result; null while no body exists (pending, accepted, expired, unknown). */
export async function openResourceResult(receipt: ResourceReceipt, crypto: FileCipherPort): Promise<ResourceResultBody | null> {
  const result = receipt.result;
  if (!result?.packet) return null;
  validateResourceResult(receipt.command, result);
  return resourceResultBodySchema.parse(await open(receipt.command.encryptedSpace, result.packet,
    resultContext(crypto.scope, receipt.command, receipt.command.ciphertextHash, result), RESOURCE_LIMITS.resultEnvelopeBytes, crypto));
}
