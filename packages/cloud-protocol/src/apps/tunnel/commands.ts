/**
 * [INPUT]: Current protocol version, purpose 10/11 account encryption and dormant-only command/grant schemas.
 * [OUTPUT]: Version-checked openTunnelCommand plus sealTunnelCommand and sealTunnelResult/openTunnelResult.
 * [POS]: Test-build extension of opaque resource transport; production action registries remain unchanged.
 */
import { z } from "zod";
import { PROTOCOL_VERSION } from "../../config";
import { createResourceCommandContext, createResourceResultContext, encodeBase64url, decodeBase64url, canonicalJson, assertExpectedScope } from "../../encryption";
import type { FileCipherPort } from "../../blobs/encrypted/model";
import { validateResourceCommand, validateResourceResult } from "../../resources/encrypted";
import type { ResourceCommandHeader, EncryptedResourceCommand, EncryptedResourceResult } from "../../resources/model";
import { tunnelCommandSchema, tunnelGrantSchema } from "./model";
const binding = (h: ResourceCommandHeader) => ({ protocolVersion: h.protocolVersion, sourceDeviceId: h.sourceDeviceId, targetDeviceId: h.targetDeviceId,
  resourceKind: h.resourceKind, resourceId: h.resourceId, commandClass: h.class, critical: h.critical, expiresAt: h.expiresAt });
const resultSchema = z.object({ ok: z.literal(true), grant: tunnelGrantSchema.nullable() }).strict();
export async function sealTunnelCommand(header: ResourceCommandHeader, body: z.infer<typeof tunnelCommandSchema>, crypto: FileCipherPort) {
  const parsed = tunnelCommandSchema.parse(body);
  if (header.resourceKind !== "app" || header.class !== "control" || header.critical !== (parsed.action === "close-tunnel")) throw new Error("tunnel-command-class");
  const packet = await seal(createResourceCommandContext(crypto.scope, header.commandId, header.commandId, binding(header)), parsed, crypto);
  return validateResourceCommand({ ...header, encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, packet });
}
export async function openTunnelCommand(raw: EncryptedResourceCommand, targetDeviceId: string, crypto: FileCipherPort) {
  const command = validateResourceCommand(raw);
  if (command.protocolVersion !== PROTOCOL_VERSION) throw new Error("protocol-mismatch");
  assertExpectedScope(command.encryptedSpace.scope, crypto.scope);
  if (command.targetDeviceId !== targetDeviceId || command.encryptedSpace.keyPackageFingerprint !== crypto.keyPackageFingerprint ||
    command.resourceKind !== "app" || command.class !== "control" || command.expiresAt <= Date.now()) throw new Error("tunnel-command-invalid");
  const result = await crypto.run({ kind: "decrypt", expectedContext: createResourceCommandContext(crypto.scope, command.commandId, command.commandId, binding(command)),
    envelope: decodeBase64url(command.packet.envelope, 1, 24_576) });
  if (result.kind !== "decrypted") throw new Error("tunnel-command-invalid");
  try { const body = tunnelCommandSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext)));
    if (command.critical !== (body.action === "close-tunnel")) throw new Error("tunnel-command-class"); return body;
  } finally { result.plaintext.fill(0); }
}
const context = (command: EncryptedResourceCommand, crypto: FileCipherPort) => createResourceResultContext(crypto.scope, command.commandId, command.commandId,
  { ...binding(command), commandCiphertextHash: command.packet.ciphertextHash, resultRevision: 2, state: "succeeded" });
export async function sealTunnelResult(command: EncryptedResourceCommand, value: z.infer<typeof resultSchema>, crypto: FileCipherPort): Promise<EncryptedResourceResult> {
  const packet = await seal(context(command, crypto), resultSchema.parse(value), crypto);
  return validateResourceResult({ ...command, ciphertextHash: command.packet.ciphertextHash }, { revision: 2, state: "succeeded", packet });
}
export async function openTunnelResult(command: EncryptedResourceCommand, result: EncryptedResourceResult, crypto: FileCipherPort) {
  validateResourceResult({ ...command, ciphertextHash: command.packet.ciphertextHash }, result);
  if (!result.packet || result.state !== "succeeded" || result.revision !== 2) throw new Error("tunnel-result-invalid");
  const opened = await crypto.run({ kind: "decrypt", expectedContext: context(command, crypto), envelope: decodeBase64url(result.packet.envelope, 1, 24_576) });
  if (opened.kind !== "decrypted") throw new Error("tunnel-result-invalid");
  try { return resultSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext))); } finally { opened.plaintext.fill(0); }
}
async function seal(context: ReturnType<typeof createResourceCommandContext> | ReturnType<typeof createResourceResultContext>, value: unknown, crypto: FileCipherPort) {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try { const result = await crypto.run({ kind: "encrypt", context, plaintext });
    if (result.kind !== "encrypted") throw new Error("tunnel-command-invalid");
    return { envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.length };
  } finally { plaintext.fill(0); }
}
