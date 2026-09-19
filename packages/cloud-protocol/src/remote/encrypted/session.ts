/**
 * [INPUT]: Fixed scoped transport, admitted crypto/clock and original caller-owned attempts.
 * [OUTPUT]: Shared preparation, exact retry, request-bound execution replies and closed admission rejection.
 * [POS]: Stateless remote adapter; ciphertext custody belongs to the existing UI attempt or native ledger.
 */
import { queryProjectFiles } from "../workspace/client";
import type { projectQueryInputSchema } from "../workspace/model";
import type { z } from "zod";
import type { CloudFunctionArgs, CloudFunctionResult } from "../../index";
import type { ProtocolHeader } from "../../config";
import type { ServerClock } from "../../continuity/clock";
import { assertCrypto, assertExpectedScope } from "../../encryption";
import { openChatHeadForRequest } from "../../chats/encrypted/client";
import { hashRemoteCommand, type RemoteCommandInput } from "../model";
import { remoteAdmissionRejection, type RemoteAdmissionRejected } from "../selection";
import { frozenRemoteCommandSchema, frozenRemoteCreationSchema, type EncryptedRemoteReceipt, type EncryptedRemoteTargets,
  type FrozenRemoteCommand, type FrozenRemoteCreation, type RemoteCreationInput } from "./model";
import { openRemoteReceipt, prepareRemoteCommand, type RemoteCipherPort } from "./client";
import { openRemoteCreationReceipt, openRemoteTargets, prepareRemoteCreation } from "./creation";
import { remoteHash, validateRemoteCommand, validateRemoteCreation } from "./wire";
type Query = "remote/workspace:get" | "chats/metadata:head" | "remote/commands:get" | "remote/commands:page" | "remote/capabilities:targets" | "remote/chats:created";
type Mutation = "remote/workspace:submit" | "remote/commands:submit" | "remote/chats:create" | "remote/chats:retryPreparation" | "turns/executor:claim";
interface RemoteCodecTransport {
  query<N extends Query>(name: N, args: CloudFunctionArgs<N>): Promise<CloudFunctionResult<N>>;
  mutate<N extends Mutation>(name: N, args: CloudFunctionArgs<N>): Promise<CloudFunctionResult<N>>;
}
export class RemoteClientCodec {
  constructor(private readonly ports: { transport: RemoteCodecTransport; header: ProtocolHeader; crypto(): RemoteCipherPort; clock(): ServerClock; current(): void }) {}
  header() { const crypto = this.ports.crypto(); this.ports.current(); return { ...this.ports.header, expectedUserId: crypto.session.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }; }
  private async call<T>(operation: Promise<T>) { const result = await operation; this.ports.current(); return result; }
  private async admission<T>(operation: Promise<T>): Promise<T | RemoteAdmissionRejected> {
    try { return await this.call(operation); }
    catch (error) {
      this.ports.current();
      const rejected = remoteAdmissionRejection(error); if (rejected) return { rejected };
      throw error;
    }
  }
  private async target(deviceId: string, chatId: string | null, projectId?: string | null) {
    let cursor: string | null = null;
    for (let page = 0; page < 32; page++) {
      const targets: EncryptedRemoteTargets = await this.call(this.ports.transport.query("remote/capabilities:targets", { ...this.header(), chatId, projectId, cursor }));
      const target = targets.items.find(item => item.deviceId === deviceId); if (target) return target;
      if (targets.complete || !targets.cursor) break; cursor = targets.cursor;
    }
    throw new Error("device-offline");
  }
  async prepare(input: RemoteCommandInput, signal?: AbortSignal) {
    const head = await this.call(this.ports.transport.query("chats/metadata:head", { ...this.header(), chatId: input.chatId }));
    assertCrypto(head !== null && (input.intent !== undefined || head.remoteCreation === null));
    const crypto = this.ports.crypto(), opened = await this.call(openChatHeadForRequest(head, input.chatId, crypto, signal));
    const target = await this.target(input.targetDeviceId, input.chatId);
    return this.call(prepareRemoteCommand(input, opened, target, this.ports.header, crypto, this.ports.clock(), signal));
  }
  async submit(input: RemoteCommandInput, raw: FrozenRemoteCommand, signal?: AbortSignal) {
    const frozen = frozenRemoteCommandSchema.parse(raw), crypto = this.ports.crypto();
    assertExpectedScope(frozen.encryptedSpace.scope, crypto.scope);
    assertCrypto(frozen.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint && frozen.plaintextHash ===
      hashRemoteCommand({ ...input, ...this.ports.header, sourceDeviceId: crypto.session.deviceId }));
    validateRemoteCommand(crypto.scope, frozen.command);
    const prior = await this.call(this.ports.transport.query("remote/commands:get", { ...this.header(), commandId: input.commandId }));
    if (prior) { assertCrypto(prior.command.ciphertextHash === frozen.command.ciphertextHash); return this.receipt(prior, signal); }
    const receipt = await this.admission(this.ports.transport.mutate("remote/commands:submit", { ...this.header(), command: frozen.command }));
    if ("rejected" in receipt) return receipt;
    assertCrypto(receipt.command.ciphertextHash === frozen.command.ciphertextHash); return this.receipt(receipt, signal);
  }
  receipt(value: EncryptedRemoteReceipt, signal?: AbortSignal) { return this.call(openRemoteReceipt(value, this.ports.header, this.ports.crypto(), signal)); }
  async page(value: CloudFunctionResult<"remote/commands:page">, signal?: AbortSignal) {
    const items = []; for (const receipt of value.items) items.push(await this.receipt(receipt, signal)); return { ...value, items };
  }
  targets(value: EncryptedRemoteTargets, signal?: AbortSignal) { return this.call(openRemoteTargets(value, this.ports.crypto(), signal)); }
  async projectFiles(input: z.infer<typeof projectQueryInputSchema>, signal: AbortSignal) {
    const target = await this.target(input.targetDeviceId, null, input.projectId);
    if (!target.online || !target.connectionEpoch) throw new Error("device-offline");
    return this.call(queryProjectFiles(input, { crypto: this.ports.crypto(), clock: this.ports.clock(), protocolVersion: this.ports.header.protocolVersion,
      connectionEpoch: target.connectionEpoch, current: this.ports.current,
      submit: request => this.ports.transport.mutate("remote/workspace:submit", { ...this.header(), request }),
      get: queryId => this.ports.transport.query("remote/workspace:get", { ...this.header(), queryId }) }, signal));
  }
  async prepareCreate(input: RemoteCreationInput, signal?: AbortSignal) {
    const target = await this.target(input.targetDeviceId, null, input.projectId);
    return this.call(prepareRemoteCreation(input, target, this.ports.header, this.ports.crypto(), this.ports.clock(), signal));
  }
  async create(input: RemoteCreationInput, raw: FrozenRemoteCreation, signal?: AbortSignal) {
    const frozen = frozenRemoteCreationSchema.parse(raw), crypto = this.ports.crypto();
    assertExpectedScope(frozen.encryptedSpace.scope, crypto.scope);
    assertCrypto(frozen.encryptedSpace.keyPackageFingerprint === crypto.keyPackageFingerprint && frozen.plaintextHash === remoteHash(input) &&
      frozen.creation.createOperationId === input.createOperationId && frozen.creation.binding.sourceDeviceId === crypto.session.deviceId &&
      frozen.creation.binding.targetDeviceId === input.targetDeviceId && frozen.creation.binding.agent === input.backend && frozen.creation.binding.projectId === input.projectId);
    validateRemoteCreation(crypto.scope, frozen.creation);
    const prior = await this.call(this.ports.transport.query("remote/chats:created", { ...this.header(), createOperationId: input.createOperationId }));
    const receipt = prior ?? await this.admission(this.ports.transport.mutate("remote/chats:create", { ...this.header(), creation: frozen.creation }));
    if ("rejected" in receipt) return receipt;
    assertCrypto(receipt.ciphertextHash === frozen.creation.ciphertextHash);
    return this.creationReceipt(receipt, signal);
  }
  creationReceipt(value: CloudFunctionResult<"remote/chats:create">, signal?: AbortSignal) { return this.call(openRemoteCreationReceipt(value, this.ports.crypto(), signal)); }
  async head(value: CloudFunctionResult<"remote/chats:retryPreparation">, expected: { chatId: string; incarnationId: string }, signal?: AbortSignal) {
    assertCrypto(value.chat.incarnationId === expected.incarnationId);
    return this.call(openChatHeadForRequest(value, expected.chatId, this.ports.crypto(), signal));
  }
}
