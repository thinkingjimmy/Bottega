/**
 * [INPUT]: Admitted workers, exact capability envelopes and immutable UUID creation attempts.
 * [OUTPUT]: Authenticated Agent defaults with retained connection epochs, original creation capsules and retired receipt projections.
 * [POS]: Client-only remote creation codec; no server path reads Agent preferences or initial Chat content.
 */
import { z } from "zod";
import type { ProtocolHeader } from "../../config";
import type { ServerClock } from "../../continuity/clock";
import { assertCrypto, assertExpectedScope } from "../../encryption";
import { turnOptionsSchema } from "../../chats/options";
import { canonicalJson } from "../../encryption/encoding";
import { utf8Length } from "../../chats/content/parts";
import { remoteAgentsSchema, remoteCreationReceiptSchema, remoteModelsSchema, remoteTargetsSchema, type RemoteAgentCapability } from "../model";
import { encryptedRemoteAgentsSchema, encryptedRemoteCreationReceiptSchema, frozenRemoteCreationSchema, remoteCreationInputSchema, REMOTE_CIPHER_LIMITS,
  type EncryptedRemoteCreation, type EncryptedRemoteCreationReceipt, type EncryptedRemoteTargets, type RemoteCreationInput } from "./model";
import { remoteCapabilityContext, remoteCreationContext, remoteCreationIdentity, remoteHash, validateRemoteCreation } from "./wire";
import { openRemotePacket, sealRemotePacket, type RemoteCipherPort } from "./client";
import { remoteComposerCapabilitiesSchema } from "../input/model";
import { agentUsageLimitsSchema, sortQuotaPools } from "../quota";
const privateDefaults = z.object({ schema: z.literal("bottega.remote-defaults/v1"), options: turnOptionsSchema, capabilities: remoteComposerCapabilitiesSchema.optional(), models: remoteModelsSchema.optional(), quota: agentUsageLimitsSchema.optional() }).strict();
const remoteCreationFactsSchema = z.object({ schema: z.literal("bottega.remote-creation/v1"), title: z.null(), options: turnOptionsSchema,
  createdAt: z.number().int().nonnegative() }).strict();
function boundedQuota(quota: NonNullable<RemoteAgentCapability["quota"]>) {
  const result = { ...quota, pools: [] as typeof quota.pools };
  for (const pool of sortQuotaPools(quota.pools)) {
    // Keep each pool complete: dropping its tightest window would overstate remaining quota.
    if (utf8Length(canonicalJson({ ...result, pools: [...result.pools, pool] })) <= REMOTE_CIPHER_LIMITS.capabilityPlaintextBytes / 2) result.pools.push(pool);
  }
  return result;
}
function capabilityDefaults({ options, capabilities, models, quota: rawQuota }: RemoteAgentCapability) {
  const quota = rawQuota && boundedQuota(rawQuota);
  const defaults = { schema: "bottega.remote-defaults/v1" as const, options, ...(quota ? { quota } : {}), ...(capabilities ? { capabilities } : {}) };
  if (!models) return defaults;
  const complete = { ...defaults, models };
  if (utf8Length(canonicalJson(complete)) <= REMOTE_CIPHER_LIMITS.capabilityPlaintextBytes) return complete;
  // Catalogs are optional discovery data. Keep the selected/default models before filling the remaining byte budget.
  const selected = options && "model" in options ? options.model : undefined;
  const prioritized = [...models].sort((a, b) => Number(b.slug === selected) - Number(a.slug === selected) || Number(b.isDefault) - Number(a.isDefault));
  const retained: NonNullable<RemoteAgentCapability["models"]> = [];
  for (const model of prioritized) {
    const candidate = { ...defaults, models: [...retained, model] };
    if (utf8Length(canonicalJson(candidate)) <= REMOTE_CIPHER_LIMITS.capabilityPlaintextBytes) retained.push(model);
  }
  const slugs = new Set(retained.map(model => model.slug));
  return { ...defaults, models: models.filter(model => slugs.has(model.slug)) };
}
export async function sealRemoteCapabilities(agents: RemoteAgentCapability[], connectionEpoch: string, header: ProtocolHeader, crypto: RemoteCipherPort, signal?: AbortSignal) {
  const result = [];
  for (const value of remoteAgentsSchema.parse(agents)) {
    const { options, capabilities, models, quota, ...publicValue } = value, publicationId = globalThis.crypto.randomUUID();
    const context = remoteCapabilityContext(crypto.scope, { ...publicValue, deviceId: crypto.session.deviceId, connectionEpoch, publicationId, protocolVersion: header.protocolVersion });
    result.push({ ...publicValue, publicationId, packet: options ? await sealRemotePacket(crypto, context, capabilityDefaults({ ...publicValue, options, capabilities, models, quota }), signal) : null });
  }
  return encryptedRemoteAgentsSchema.parse(result);
}
async function openRemoteTarget(target: EncryptedRemoteTargets["items"][number], crypto: RemoteCipherPort, signal?: AbortSignal) {
  const agents: RemoteAgentCapability[] = [];
  if (target.agents.length) {
    assertCrypto(target.connectionEpoch !== null && target.encryptedSpace !== null);
    assertExpectedScope(target.encryptedSpace.scope, crypto.scope);
    assertCrypto(target.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
    for (const value of target.agents) {
      const { packet, publicationId, ...publicValue } = value;
      const defaults = packet ? privateDefaults.parse(await openRemotePacket(crypto, remoteCapabilityContext(crypto.scope, { ...publicValue,
        deviceId: target.deviceId, connectionEpoch: target.connectionEpoch, publicationId, protocolVersion: target.protocolVersion }), packet, signal)) : null;
      agents.push({ ...publicValue, options: defaults?.options ?? null, ...(defaults?.quota ? { quota: defaults.quota } : {}), ...(defaults?.capabilities ? { capabilities: defaults.capabilities } : {}), ...(defaults?.models ? { models: defaults.models } : {}) });
    }
  }
  const { encryptedSpace: _space, ...publicTarget } = target;
  return { ...publicTarget, agents: remoteAgentsSchema.parse(agents) };
}
export async function openRemoteTargets(page: EncryptedRemoteTargets, crypto: RemoteCipherPort, signal?: AbortSignal) {
  const items = []; for (const target of page.items) items.push(await openRemoteTarget(target, crypto, signal));
  return remoteTargetsSchema.parse({ ...page, items });
}
export async function prepareRemoteCreation(raw: RemoteCreationInput, target: EncryptedRemoteTargets["items"][number], header: ProtocolHeader,
  crypto: RemoteCipherPort, clock: ServerClock, signal?: AbortSignal) {
  const input = remoteCreationInputSchema.parse(raw), opened = await openRemoteTarget(target, crypto, signal);
  const agent = opened.agents.find(agent => agent.backend === input.backend && agent.available && agent.options);
  assertCrypto(target.deviceId === input.targetDeviceId && target.connectionEpoch !== null && target.online && agent?.options !== null && agent?.options !== undefined);
  await clock.refresh(); const now = clock.estimate(); assertCrypto(now !== null);
  const creation: EncryptedRemoteCreation = { createOperationId: input.createOperationId, binding: { sourceDeviceId: crypto.session.deviceId,
    targetDeviceId: input.targetDeviceId, connectionEpoch: target.connectionEpoch, agent: input.backend, expectedAgentRevision: 0,
    projectId: input.projectId, protocolVersion: header.protocolVersion, createdAt: now.lower }, createdAt: now.lower,
    packet: { envelope: "AA", ciphertextHash: "0".repeat(64), ciphertextBytes: 1 }, ciphertextHash: "0".repeat(64) };
  creation.packet = await sealRemotePacket(crypto, remoteCreationContext(crypto.scope, creation),
    remoteCreationFactsSchema.parse({ schema: "bottega.remote-creation/v1", title: null, options: agent.options, createdAt: creation.createdAt }), signal);
  creation.ciphertextHash = creation.packet.ciphertextHash;
  return frozenRemoteCreationSchema.parse({ kind: "encrypted-remote-creation", encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
    plaintextHash: remoteHash(input), creation });
}
export async function openRemoteCreation(creation: EncryptedRemoteCreation, crypto: RemoteCipherPort, signal?: AbortSignal) {
  validateRemoteCreation(crypto.scope, creation);
  const facts = remoteCreationFactsSchema.parse(await openRemotePacket(crypto, remoteCreationContext(crypto.scope, creation), creation.packet, signal));
  assertCrypto(facts.options.backend === creation.binding.agent && facts.createdAt === creation.createdAt && creation.createdAt === creation.binding.createdAt);
  return facts;
}
export async function openRemoteCreationReceipt(raw: EncryptedRemoteCreationReceipt, crypto: RemoteCipherPort, signal?: AbortSignal) {
  const receipt = encryptedRemoteCreationReceiptSchema.parse(raw);
  assertExpectedScope(receipt.encryptedSpace.scope, crypto.scope);
  assertCrypto(receipt.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const identity = remoteCreationIdentity(crypto.scope, receipt.createOperationId);
  assertCrypto(receipt.chatId === identity.chatId && receipt.incarnationId === identity.incarnationId);
  if (receipt.deleted) return remoteCreationReceiptSchema.parse({ createOperationId: receipt.createOperationId, payloadHash: null, ...identity,
    ownerDeviceId: receipt.ownerDeviceId, createdAt: receipt.createdAt, deleted: true });
  const creation = receipt.creation; assertCrypto(creation !== null);
  await openRemoteCreation(creation, crypto, signal);
  assertCrypto(receipt.createOperationId === creation.createOperationId && receipt.ciphertextHash === creation.ciphertextHash &&
    receipt.chatId === identity.chatId && receipt.incarnationId === identity.incarnationId && receipt.ownerDeviceId === creation.binding.targetDeviceId &&
    receipt.createdAt === creation.createdAt);
  const input = { createOperationId: receipt.createOperationId, targetDeviceId: receipt.ownerDeviceId, backend: creation.binding.agent, projectId: creation.binding.projectId };
  return remoteCreationReceiptSchema.parse({ createOperationId: receipt.createOperationId, payloadHash: remoteHash(input), ...identity,
    ownerDeviceId: receipt.ownerDeviceId, createdAt: receipt.createdAt, deleted: receipt.deleted });
}
