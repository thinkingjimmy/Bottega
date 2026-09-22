/**
 * [INPUT]: Admitted worker, calibrated server clock, original remote inputs and authenticated Chat/target snapshots.
 * [OUTPUT]: Frozen command bytes, verified private receipts and encrypted local execution reports.
 * [POS]: Client-only remote codec; caller-owned attempts and coordinator records own retry custody.
 */
import { isRemoteWorkspaceQuery, assertRemoteReferenceTarget } from "../input/references";
import { isRemoteTurnPayload } from "../model";
import { z } from "zod";
import { privateIntent, deliveredIntent } from "./intent";
import type { ProtocolHeader } from "../../config";
import { canonicalJson } from "../../encryption/encoding";
import type { FileCipherPort } from "../../blobs/encrypted";
import type { ServerClock } from "../../continuity/clock";
import { assertCrypto, assertExpectedScope, encodeBase64url, type CryptoContext } from "../../encryption";
import type { CloudChatHead } from "../../chats/model";
import { hashRemoteCommand, remoteCommandInputSchema, remoteCommandSchema, remotePayloadSchema, remoteReceiptSchema, remoteReportSchema,
  type RemoteCommandInput, type RemoteCommandReport } from "../model";
import { encryptedRemoteReceiptSchema, encryptedRemoteReportSchema, frozenRemoteCommandSchema, remotePacketSchema,
  type EncryptedRemoteCommand, type EncryptedRemoteReceipt, type RemotePacket, type EncryptedRemoteTargets } from "./model";
import { remoteCommandContext, remoteResultContext, validateRemoteCommand, validateRemotePacket } from "./wire";
import { remoteAttachmentBlobIds, remoteConsentMatches } from "../input/model";
export type RemoteCipherPort = FileCipherPort;
export async function sealRemotePacket(crypto: RemoteCipherPort, context: CryptoContext, value: unknown, signal?: AbortSignal): Promise<RemotePacket> {
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  try {
    const result = await crypto.run({ kind: "encrypt", context, plaintext }, signal); assertCrypto(result.kind === "encrypted");
    return remotePacketSchema.parse({ envelope: encodeBase64url(result.envelope), ciphertextHash: result.ciphertextHash, ciphertextBytes: result.envelope.byteLength });
  } finally { plaintext.fill(0); }
}
export async function openRemotePacket(crypto: RemoteCipherPort, context: CryptoContext, packet: RemotePacket, signal?: AbortSignal): Promise<unknown> {
  const envelope = validateRemotePacket(context, packet), result = await crypto.run({ kind: "decrypt", expectedContext: context, envelope }, signal);
  assertCrypto(result.kind === "decrypted");
  try { const text = new TextDecoder("utf-8", { fatal: true }).decode(result.plaintext), value: unknown = JSON.parse(text);
    assertCrypto(canonicalJson(value) === text); return value;
  } finally { result.plaintext.fill(0); }
}
const privateCommand = z.object({ schema: z.literal("bottega.remote-command/v1"), payload: remotePayloadSchema }).strict();
export async function prepareRemoteCommand(raw: RemoteCommandInput, head: CloudChatHead, target: EncryptedRemoteTargets["items"][number],
  header: ProtocolHeader, crypto: RemoteCipherPort, clock: ServerClock, signal?: AbortSignal) {
  const input = remoteCommandInputSchema.parse(raw), payload = input.payload;
  assertCrypto(input.chatId === head.chat.id && input.incarnationId === head.chat.incarnationId && (isRemoteWorkspaceQuery(payload.kind) || input.intent && payload.kind === "start-turn" || input.targetDeviceId === head.ownerDeviceId) && target.deviceId === input.targetDeviceId && target.connectionEpoch !== null && target.encryptedSpace !== null);
  if ("references" in payload) assertRemoteReferenceTarget(payload.references ?? [], input.targetDeviceId);
  if (payload.kind === "read-workspace-file") assertRemoteReferenceTarget([payload.reference], input.targetDeviceId);
  assertExpectedScope(target.encryptedSpace.scope, crypto.scope);
  assertCrypto(target.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint && target.protocolVersion === header.protocolVersion);
  if (input.intent) assertCrypto(payload.kind === "start-turn");
  if (!input.intent && isRemoteTurnPayload(payload)) assertCrypto(payload.expectedAgentRevision === head.chat.agentRevision);
  if (isRemoteTurnPayload(payload) || payload.kind === "steer") {
    for (const attachment of payload.attachments ?? []) assertCrypto(attachment.blob.encryption.owner.kind === "chat" && attachment.blob.encryption.owner.id === input.chatId &&
      canonicalJson(attachment.blob.encryption.encryptedSpace.scope) === canonicalJson(crypto.scope));
  }
  if (isRemoteTurnPayload(payload) && payload.fullAccessConsent) assertCrypto(remoteConsentMatches(payload.fullAccessConsent, {
    userId: crypto.session.userId, sourceDeviceId: crypto.session.deviceId, chatId: input.chatId, incarnationId: input.incarnationId,
    targetDeviceId: input.targetDeviceId, intentId: input.commandId,
  }));
  const expiresAt = await clock.freezeDeadline(input.intent ? "intent" : payload.kind);
  const command: EncryptedRemoteCommand = { ...header, ...(input.intent ? { intent: { expiresAt } } : {}), commandId: input.commandId, chatId: input.chatId, incarnationId: input.incarnationId,
    targetDeviceId: input.targetDeviceId, sourceDeviceId: crypto.session.deviceId,
    connectionEpoch: target.connectionEpoch, protocolVersion: header.protocolVersion, kind: payload.kind,
    requestId: "requestId" in payload ? payload.requestId : null,
    interactionId: payload.kind === "respond-approval" ? payload.approvalId : payload.kind === "respond-user-input" ? payload.userInputId : null,
    backend: isRemoteTurnPayload(payload) ? payload.agentSelection?.backend ?? null : null,
    expectedAgentRevision: head.chat.agentRevision,
    ...(remoteAttachmentBlobIds(payload).length ? { attachmentBlobIds: remoteAttachmentBlobIds(payload) } : {}),
    expectedChatVersion: isRemoteTurnPayload(payload) ? payload.agentSelection?.expectedFactRevision ?? head.catalogRevision : head.catalogRevision,
    expiresAt, packet: { envelope: "AA", ciphertextHash: "0".repeat(64), ciphertextBytes: 1 }, ciphertextHash: "0".repeat(64) };
  command.packet = await sealRemotePacket(crypto, remoteCommandContext(crypto.scope, command), input.intent ? privateIntent(input) : { schema: "bottega.remote-command/v1", payload }, signal);
  command.ciphertextHash = command.packet.ciphertextHash;
  return frozenRemoteCommandSchema.parse({ kind: "encrypted-remote-command", encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint },
    plaintextHash: hashRemoteCommand({ ...input, ...header, sourceDeviceId: crypto.session.deviceId }), command });
}
async function openRemoteCommand(receipt: EncryptedRemoteReceipt, header: ProtocolHeader, crypto: RemoteCipherPort, signal?: AbortSignal) {
  assertExpectedScope(receipt.encryptedSpace.scope, crypto.scope);
  assertCrypto(receipt.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint);
  const value = validateRemoteCommand(crypto.scope, receipt.command);
  const raw = await openRemotePacket(crypto, remoteCommandContext(crypto.scope, value), value.packet, signal);
  const decoded = value.intent ? deliveredIntent(raw, value) : { ...privateCommand.parse(raw), intent: undefined };
  const { payload, intent } = decoded;
  assertCrypto(canonicalJson(remoteAttachmentBlobIds(payload)) === canonicalJson(value.attachmentBlobIds ?? []));
  if (isRemoteTurnPayload(payload) || payload.kind === "steer") for (const attachment of payload.attachments ?? []) {
    assertCrypto(attachment.blob.encryption.owner.kind === "chat" && attachment.blob.encryption.owner.id === value.chatId &&
      canonicalJson(attachment.blob.encryption.encryptedSpace.scope) === canonicalJson(crypto.scope));
  }
  assertCrypto(payload.kind === value.kind && value.protocolVersion === header.protocolVersion &&
    (isRemoteTurnPayload(payload) ? payload.expectedAgentRevision === value.expectedAgentRevision &&
      (payload.agentSelection?.backend ?? null) === value.backend && (payload.agentSelection?.expectedFactRevision ?? value.expectedChatVersion) === value.expectedChatVersion : ("requestId" in payload ? payload.requestId : null) === value.requestId) &&
    (payload.kind === "respond-approval" ? payload.approvalId : payload.kind === "respond-user-input" ? payload.userInputId : null) === value.interactionId);
  if (isRemoteTurnPayload(payload) && payload.fullAccessConsent) assertCrypto(remoteConsentMatches(payload.fullAccessConsent, {
    userId: crypto.session.userId, sourceDeviceId: value.sourceDeviceId, chatId: value.chatId, incarnationId: value.incarnationId,
    targetDeviceId: value.targetDeviceId, intentId: value.commandId }));
  const input = { commandId: value.commandId, chatId: value.chatId, incarnationId: value.incarnationId, targetDeviceId: value.targetDeviceId,
    ...(intent ? { intent } : {}), payload, environmentId: value.environmentId, deploymentId: value.deploymentId, protocolVersion: value.protocolVersion, sourceDeviceId: value.sourceDeviceId };
  return remoteCommandSchema.parse({ ...input, payloadHash: hashRemoteCommand(input), ciphertextHash: value.ciphertextHash, connectionEpoch: value.connectionEpoch,
    sourceDeviceName: receipt.sourceDeviceName, createdAt: receipt.createdAt, expiresAt: value.expiresAt });
}
export async function prepareRemoteReport(command: EncryptedRemoteCommand, raw: RemoteCommandReport, revision: number, crypto: RemoteCipherPort, signal?: AbortSignal) {
  const report = remoteReportSchema.parse(raw), admission = "admission" in report ? report.admission : null;
  const metadata = { revision, state: report.state, admission: admission ? { intentId: admission.intentId, requestId: admission.requestId, userMessageId: admission.userMessageId } : null,
    blockedBy: "blockedBy" in report ? report.blockedBy : null, noAdmission: "noAdmission" in report && report.noAdmission };
  const packet = await sealRemotePacket(crypto, remoteResultContext(crypto.scope, command, metadata), report, signal);
  return encryptedRemoteReportSchema.parse({ ...metadata, packet });
}
export async function openRemoteReceipt(raw: EncryptedRemoteReceipt, header: ProtocolHeader, crypto: RemoteCipherPort, signal?: AbortSignal) {
  const receipt = encryptedRemoteReceiptSchema.parse(raw), command = await openRemoteCommand(receipt, header, crypto, signal);
  let report: RemoteCommandReport | null = null;
  if (receipt.report) {
    const { packet, ...metadata } = receipt.report;
    report = remoteReportSchema.parse(await openRemotePacket(crypto, remoteResultContext(crypto.scope, receipt.command, metadata), packet, signal));
    const admission = "admission" in report ? report.admission : null;
    assertCrypto(report.state === metadata.state && canonicalJson(admission ? { intentId: admission.intentId, requestId: admission.requestId, userMessageId: admission.userMessageId } : null) ===
      canonicalJson(metadata.admission) && canonicalJson(metadata.admission) === canonicalJson(receipt.admission) &&
      metadata.noAdmission === ("noAdmission" in report && report.noAdmission) && metadata.blockedBy === ("blockedBy" in report ? report.blockedBy : null));
  } else assertCrypto(receipt.admission === null);
  return remoteReceiptSchema.parse({ command, state: receipt.state, admission: report && "admission" in report ? report.admission : null,
    blockedBy: receipt.blockedBy, ...(receipt.queueSequence === undefined ? {} : { queueSequence: receipt.queueSequence }), ...(receipt.withdrawalRequested ? { withdrawalRequested: true } : {}), reason: report?.state === receipt.state && "reason" in report ? report.reason : receipt.reason,
    result: report?.state === receipt.state && "result" in report ? report.result : null,
    ...(report?.state === receipt.state && "resolvedBy" in report && report.resolvedBy ? { resolvedBy: report.resolvedBy } : {}),
    ...(report?.state === receipt.state && "output" in report && report.output ? { output: report.output } : {}),
    claimedAt: receipt.claimedAt, acceptedAt: receipt.acceptedAt, updatedAt: receipt.updatedAt });
}
