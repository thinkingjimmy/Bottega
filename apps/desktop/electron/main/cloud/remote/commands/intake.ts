/**
 * [INPUT]: Exact encrypted commands, current account/clock, existing coordinator evidence and original ledger custody.
 * [OUTPUT]: Claims and decrypts bounded commands, freezes hash mappings before admission and reports immutable encrypted evidence without rejecting accepted work when result reads fail.
 * [POS]: Main-only intake; current authority and calibrated deadlines gate effects independently from historical receipt recovery.
 */
import { isRemoteWorkspaceQuery } from "@ai-chat/cloud-protocol/remote/input/references";
import { isRemoteTurnPayload } from "@ai-chat/cloud-protocol/remote/model";
import { RemoteTransportFailure, remoteRequest } from "./transport-error";
import { commandAdmission } from "./evidence";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { validateRemoteCommand, remoteHash, type EncryptedRemoteReceipt } from "@ai-chat/cloud-protocol/remote/encrypted";
import { openRemoteReceipt, prepareRemoteReport, type RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import { openChatHeadForRequest } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import type { ServerClock } from "@ai-chat/cloud-protocol/continuity/clock";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { remoteReasonSchema, type RemoteCommand, type RemoteCommandReport, type RemoteCommandReceipt } from "@ai-chat/cloud-protocol/remote/model";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ManualTurnReceipt } from "../../../../../shared/sections-ipc";
import type { AccountTransport } from "../../runtime/transport";
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import type { TrustedTurnAuthority } from "../../../backends/types";
import type { RemoteContext } from "../../../sections/coordinator/remote/model";
export type RemoteConnection = { scope: SyncScope; connectionEpoch: string; manifestId: string; enabled: boolean; lifetimeGeneration?: number };
type Ports = { config: CloudBuildConfig; deviceId: string; ledger: RelayLedger; transport: Pick<AccountTransport, "query" | "mutate">;
  crypto(): RemoteCipherPort; clock(): ServerClock; connection(): RemoteConnection | null;
  evidence(context: RemoteContext, current: () => void, blockedBy?: "relay-queue" | "chain-paused" | "app-transition" | null): Promise<RemoteCommandReport | null>;
  admit(command: RemoteCommand, context: RemoteContext, head: CloudChatHead, current: () => void): Promise<ManualTurnReceipt>;
  withdrawUnpersisted?(context: RemoteContext, current: () => void): Promise<unknown>;
  control(command: RemoteCommand, context: RemoteContext, current: () => void): Promise<RemoteCommandReport> };
const finished = (state: RemoteCommandReceipt["state"]) => ["done", "cancelled", "error", "expired", "rejected"].includes(state);
export class RemoteCommandIntake {
  private readonly flights = new Map<string, Promise<void>>();
  private readonly chats = new Map<string, Promise<void>>();
  private readonly blockedChats = new Map<string, { commandId: string; expiresAt: number; error: unknown }>();
  private generation = 0;
  private readonly claims = new Set<string>();
  private readonly authorizations = new Map<string, Promise<void>>();
  private readonly blocked = new Map<string, "relay-queue" | "chain-paused" | "app-transition" | null>();
  constructor(private readonly ports: Ports) {}
  authority(context: RemoteContext): TrustedTurnAuthority {
    const connection = this.ports.connection(), crypto = this.ports.crypto(), clock = this.ports.clock();
    if (!connection?.enabled || connection.scope.userId !== context.scope.userId || connection.scope.environment !== context.scope.environment ||
      connection.connectionEpoch !== context.connectionEpoch || context.targetDeviceId !== this.ports.deviceId) throw new Error("connection-changed");
    const identity = JSON.stringify(connection), current = () => {
      if (JSON.stringify(this.ports.connection()) !== identity || this.ports.crypto().session.sessionId !== crypto.session.sessionId) throw new Error("connection-changed");
      const now = clock.estimate(); if (!now) throw new Error("sync-clock-unavailable");
      if (now.upper >= context.expiresAt) throw new Error("command-expired");
    };
    return { current, validate: async () => {
      await clock.assertBeforeEffect(context.expiresAt); current();
      const id = context.origin.commandId;
      // A timed-out SDK request retains its slot until the underlying request settles.
      // No retry can accumulate another authorization request for the same command.
      const previous = this.authorizations.get(id);
      if (previous) { await previous; current(); return; }
      if (this.authorizations.size >= 32) throw new Error("remote-authorization-busy");
      const args = { ...protocolHeader(this.ports.config), expectedUserId: connection.scope.userId,
        encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint }, commandId: id,
        ciphertextHash: context.origin.ciphertextHash, connectionEpoch: context.connectionEpoch,
        claimToken: remoteHash(["remote-claim", connection.scope.userId, id, context.origin.ciphertextHash]) };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const request = Promise.resolve().then(() => { current(); return remoteRequest(() => this.ports.transport.mutate("remote/commands:authorizeEffect", args)); }).then(() => { current(); });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("sync-clock-unavailable")), 5_000); });
      const flight = Promise.race([request, timeout]); this.authorizations.set(id, flight);
      void request.finally(() => { if (timer) clearTimeout(timer); if (this.authorizations.get(id) === flight) this.authorizations.delete(id); }).catch(() => {});
      await flight; current();
    } };
  }
  receive(receipt: EncryptedRemoteReceipt) {
    const id = receipt.command.commandId, prior = this.flights.get(id); if (prior) return prior;
    const chatId = receipt.command.chatId, predecessor = this.chats.get(chatId), generation = this.generation;
    const flight = Promise.resolve(predecessor).then(async () => {
      const blocked = this.blockedChats.get(chatId);
      if (blocked && blocked.commandId !== id) {
        const expired = receipt.createdAt >= blocked.expiresAt || (this.ports.clock().estimate()?.lower ?? -Infinity) >= blocked.expiresAt;
        if (!expired) throw blocked.error;
        this.blockedChats.delete(chatId);
      }
      await this.process(receipt);
      if (generation === this.generation && this.blockedChats.get(chatId)?.commandId === id) this.blockedChats.delete(chatId);
    }).catch(error => {
      if (generation === this.generation && !this.blockedChats.has(chatId)) this.blockedChats.set(chatId, { commandId: id, expiresAt: receipt.command.expiresAt, error });
      throw error;
    }).finally(() => {
      this.flights.delete(id); if (this.chats.get(chatId) === flight) this.chats.delete(chatId);
    });
    this.chats.set(chatId, flight); this.flights.set(id, flight); return flight;
  }
  async settled() { await Promise.allSettled([...this.flights.values()]); }
  reset() { this.generation++; this.claims.clear(); this.blocked.clear(); this.blockedChats.clear(); }
  private async process(initial: EncryptedRemoteReceipt) {
    const connection = this.ports.connection(); if (!connection || finished(initial.state)) return;
    const crypto = this.ports.crypto(), clock = this.ports.clock(), identity = JSON.stringify(connection);
    const current = () => { if (JSON.stringify(this.ports.connection()) !== identity || this.ports.crypto().session.sessionId !== crypto.session.sessionId) throw new Error("connection-changed"); };
    const header = { ...protocolHeader(this.ports.config), expectedUserId: connection.scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    let wire = validateRemoteCommand(crypto.scope, initial.command);
    if (wire.targetDeviceId !== this.ports.deviceId || wire.protocolVersion !== header.protocolVersion) throw new Error("REMOTE_COMMAND_IDENTITY_CHANGED");
    const claim = { ...header, commandId: wire.commandId, ciphertextHash: wire.ciphertextHash, connectionEpoch: connection.connectionEpoch,
      claimToken: remoteHash(["remote-claim", connection.scope.userId, wire.commandId, wire.ciphertextHash]) };
    const claimKey = `${connection.connectionEpoch}:${wire.commandId}`;
    let original = initial;
    if (!this.claims.has(claimKey)) {
      original = await this.ports.transport.mutate("remote/commands:claim", claim); current();
      if (finished(original.state) || original.state.startsWith("awaiting-")) return;
      wire = validateRemoteCommand(crypto.scope, original.command); this.claims.add(claimKey);
    }
    // Reject unrelated current heads before touching any command plaintext.
    const rawHead = await this.ports.transport.query("chats/metadata:head", { ...header, chatId: wire.chatId }); current();
    const known = this.ports.ledger.remote.ciphertext(wire.commandId);
    if (!known && (!rawHead || rawHead.chat.id !== wire.chatId || rawHead.chat.incarnationId !== wire.incarnationId || (!isRemoteWorkspaceQuery(wire.kind) && rawHead.ownerDeviceId !== wire.targetDeviceId) || wire.connectionEpoch !== connection.connectionEpoch || rawHead.remoteCreation)) throw new Error("not-owner");
    let receipt = await openRemoteReceipt(original, header, crypto); current(); const command = receipt.command;
    const context: RemoteContext = { origin: { kind: "remote", commandId: command.commandId, sourceDeviceId: command.sourceDeviceId,
      sourceDeviceName: command.sourceDeviceName, payloadHash: command.payloadHash, ciphertextHash: command.ciphertextHash }, scope: connection.scope,
      chatId: command.chatId, incarnationId: command.incarnationId, targetDeviceId: command.targetDeviceId,
      connectionEpoch: command.connectionEpoch, expiresAt: command.expiresAt,
      ...("references" in command.payload && command.payload.references?.length ? { references: command.payload.references } : {}),
      ...(isRemoteTurnPayload(command.payload) && command.payload.fullAccessConsent ? { fullAccessConsent: command.payload.fullAccessConsent } : {}) };
    await this.ports.ledger.remote.freezeCommand({ context, command: wire, encryptedSpace: header.encryptedSpace }); current();
    const send = async (report: RemoteCommandReport) => {
      const hash = remoteHash(report), saved = this.ports.ledger.remote.ciphertext(command.commandId)!, previous = saved.report;
      const frozen = previous?.plaintextHash === hash ? previous : await this.ports.ledger.remote.freezeReport(command.commandId,
        { plaintextHash: hash, transport: await prepareRemoteReport(wire, report, (previous?.transport.revision ?? 0) + 1, crypto) });
      current(); const result = await this.ports.transport.mutate("remote/commands:report", { ...claim, report: frozen.transport }); current();
      receipt = await openRemoteReceipt(result, header, crypto); current(); return receipt;
    };
    // An uncertain prior report is reconciled with its original bytes before allocating a new result revision.
    const previous = this.ports.ledger.remote.ciphertext(command.commandId)?.report;
    if (previous && (original.report?.revision ?? 0) < previous.transport.revision) {
      const result = await this.ports.transport.mutate("remote/commands:report", { ...claim, report: previous.transport }); current();
      receipt = await openRemoteReceipt(result, header, crypto); current(); if (finished(receipt.state)) return;
    }
    const priorControl = isRemoteTurnPayload(command.payload) ? null : this.ports.ledger.remote.control(command.commandId);
    const noAdmission = isRemoteTurnPayload(command.payload) ? !this.ports.ledger.remote.lookup(context)?.accepted : !priorControl || priorControl.state === "not-dispatched";
    if (!receipt.admission && noAdmission) { await send({ state: "claimed", noAdmission: true }); if (receipt.state !== "claimed") return; }
    const effectCurrent = () => {
      current(); const estimate = clock.estimate();
      if (!estimate) throw new Error("sync-clock-unavailable");
      if (estimate.upper >= command.expiresAt) throw new Error("command-expired");
      if (command.connectionEpoch !== connection.connectionEpoch) throw new Error("connection-changed");
    };
    let report: RemoteCommandReport;
    try {
      if (isRemoteTurnPayload(command.payload)) {
        if (receipt.withdrawalRequested && command.payload.kind === "start-turn") await this.ports.withdrawUnpersisted?.(context, current);
        if (this.ports.ledger.remote.lookup(context)?.accepted) report = (await this.ports.evidence(context, current, this.blocked.get(command.commandId))) ??
          { state: "outcome-unknown", admission: commandAdmission(context, this.ports.ledger), reason: "outcome-unknown" };
        else {
          if (!connection.enabled) throw new Error("remote-disabled"); await clock.assertBeforeEffect(command.expiresAt); effectCurrent();
          if (!rawHead || rawHead.remoteCreation) throw new Error("execution-not-ready");
          const head = await openChatHeadForRequest(rawHead, wire.chatId, crypto); effectCurrent();
          const accepted = await this.ports.admit(command, context, head, effectCurrent); current();
          const blockedBy = "blockedBy" in accepted ? accepted.blockedBy ?? null : null; this.blocked.set(command.commandId, blockedBy);
          report = (await this.ports.evidence(context, current, blockedBy)) ?? { state: "outcome-unknown", admission: commandAdmission(context, this.ports.ledger), reason: "outcome-unknown" };
        }
      } else {
        const control = this.ports.ledger.remote.control(command.commandId);
        if (!connection.enabled && (!control || control.state === "not-dispatched")) throw new Error("remote-disabled");
        report = await this.ports.control(command, context, current);
      }
    } catch (error) {
      if (error instanceof RemoteTransportFailure) throw error;
      current(); const evidence = isRemoteTurnPayload(command.payload) ? await this.ports.evidence(context, current).catch(() => null) : null;
      const control = this.ports.ledger.remote.control(command.commandId);
      const admission = isRemoteTurnPayload(command.payload) ? commandAdmission(context, this.ports.ledger) : null;
      if (evidence) report = evidence;
      else if (admission) report = { state: "outcome-unknown", admission, reason: "outcome-unknown" };
      else if (control && control.state !== "not-dispatched") report = { state: "outcome-unknown", admission: { intentId: control.id,
        submissionHash: control.payloadHash, requestId: control.requestId, userMessageId: null }, reason: "outcome-unknown" };
      else if (receipt.admission) report = { state: "outcome-unknown", admission: receipt.admission, reason: "outcome-unknown" };
      else {
        const message = error instanceof Error ? error.message : "admission-failed", reason = remoteReasonSchema.safeParse(message.startsWith("REVISION_STALE") ? "revision-stale" : message.startsWith("REVISION_NOT_IDLE") ? "revision-busy" : message);
        const estimate = clock.estimate(), expired = Boolean(estimate && estimate.upper >= command.expiresAt);
        report = { state: expired ? "expired" : "rejected", noAdmission: true, reason: reason.success ? reason.data : expired ? "command-expired" : "admission-failed" };
      }
    }
    current(); await send(report);
    if (finished(report.state)) { this.claims.delete(claimKey); this.blocked.delete(command.commandId); }
  }
}
