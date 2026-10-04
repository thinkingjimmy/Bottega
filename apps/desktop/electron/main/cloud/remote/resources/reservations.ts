/**
 * [INPUT]: Depends on the cloud transport (remote/chats:reservations and settleReservation), the remote creation and settlement codecs, the App
 *          navigation's editor checks, the local Chat store, the coordinator's remote admission (as `submit`) and the coded RecoveryPendingError.
 * [OUTPUT]: Provides RemoteReservationClaims, the reserved computer's side of an App's first Edit Chat (U06 Q7): claim (a gone or uneditable App
 *           is refused at once, sealed with the closed U06 code), materialise (the delivered first message becomes the Edit Chat, or is refused
 *           by name with the reservation sealed, startup recovery's refusal under its own code), and settle (filled once the Chat exists here; filled to the App's other Edit Chat when the
 *           first message failed at persistence).
 * [POS]: cloud/remote/resources' seam for reservations, beside the App port; the command runtime drives its pass on the same watch as
 *        preparations, and intake hands it the reservation's first message.
 */
import type { CloudFunctionArgs, CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { openRemoteCreationReceipt, sealRemoteCreationSettlement } from "@ai-chat/cloud-protocol/remote/encrypted/creation";
import type { RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import type { EncryptedRemoteCommand, EncryptedRemoteCreation } from "@ai-chat/cloud-protocol/remote/encrypted";
import type { RemoteCommand, RemoteCreationSettlement } from "@ai-chat/cloud-protocol/remote/model";
import type { ManualTurnReceipt } from "../../../../../shared/ipc/content/sections-ipc";
import type { AgentBackendId } from "../../../../../shared/ipc/agent/agent-ipc";
import type { RemoteContext } from "../../../sections/coordinator/remote/model";
import type { AccountTransport } from "../../runtime/transport/transport";
import { RecoveryPendingError } from "../../../persistence/recovery-policy";
import type { RemoteAppNavigation } from "./apps";

type Header = Omit<CloudFunctionArgs<"remote/chats:reservations">, "connectionEpoch" | "cursor">;
type Refusal = Extract<RemoteCreationSettlement, { outcome: "refused" }>["code"];
/** A reservation's first message as this computer knows it from its last pass: the only headless command intake may hand to materialise. */
export type ReservedFirst = { createOperationId: string; chatId: string; incarnationId: string; appId: string; creation: EncryptedRemoteCreation };
export type ReservationClaimPorts = {
  crypto(): RemoteCipherPort;
  transport: Pick<AccountTransport, "query" | "mutate">;
  /** Null until App mode is configured: nothing is decided before then. */
  apps(): Pick<RemoteAppNavigation, "editorAvailability" | "latestEditorChat"> | null;
  /** The local Chat at an id, as the store holds it. */
  localChat?(chatId: string): { incarnationId: string; archivedAt?: number | null; context: { kind: string; appId?: string } } | null;
  /** §8.4.4: whether this Agent can take a turn now; the server cannot see the reservation's Agent. */
  agentReady?(backend: AgentBackendId): Promise<boolean>;
  /** The coordinator's remote admission of the first message as its create-app. */
  submit?(command: RemoteCommand, context: RemoteContext, target: { appId: string; projectId: string }, current: () => void): Promise<ManualTurnReceipt>;
  report?(error: unknown): void;
};

export class RemoteReservationClaims {
  /** Reservations this launch already decided; a later pass never settles one again (the server would refuse it anyway). */
  private readonly decided = new Set<string>();
  private firsts = new Map<string, ReservedFirst>();
  private header: Header | null = null;
  constructor(private readonly ports: ReservationClaimPorts) {}

  /** `pushed` is the reservations subscription's last page (T20-5); without one the pass reads it. */
  async pass(header: Header, connectionEpoch: string, pushed: CloudFunctionResult<"remote/chats:reservations"> | null = null) {
    const apps = this.ports.apps();
    if (!apps) return;
    this.header = header;
    // A failed read (say, a server not yet redeployed with reservations) is reported and never stops the rest of the scan.
    let page: CloudFunctionResult<"remote/chats:reservations">;
    try { page = pushed ?? await this.ports.transport.query("remote/chats:reservations", { ...header, connectionEpoch, cursor: null }); }
    catch (error) { this.ports.report?.(error); return; }
    const firsts = new Map<string, ReservedFirst>();
    for (const { receipt: raw, first } of page.items) {
      const state = raw.reservation?.state;
      if (this.decided.has(raw.createOperationId) || state !== "reserved" && state !== "admitting" || !raw.creation) continue;
      try {
        // Opening proves the App the creation names: a target the server re-pointed fails here and is never answered.
        const opened = await openRemoteCreationReceipt(raw, this.ports.crypto());
        if (!opened.target) continue;
        const reserved = { createOperationId: raw.createOperationId, chatId: opened.chatId, incarnationId: opened.incarnationId, appId: opened.target.appId, creation: raw.creation };
        if (state === "reserved") {
          const available = apps.editorAvailability(reserved.appId);
          if (available.code) await this.settle(reserved, { outcome: "refused", code: available.code });
          continue;
        }
        // Admitting: filled once its Chat exists here (never on admission alone: persistence can still refuse it).
        const local = this.ports.localChat?.(reserved.chatId);
        if (local && local.incarnationId === reserved.incarnationId && local.context.kind === "app-edit" && local.context.appId === reserved.appId) {
          await this.settle(reserved, { outcome: "filled", chatId: reserved.chatId, incarnationId: reserved.incarnationId }); continue;
        }
        // §8.5: a first message that failed at persistence because the App meanwhile got another Edit Chat is settled to that Chat now.
        if (first && ["rejected", "error", "expired", "outcome-unknown"].includes(first.state)) {
          const existing = await apps.latestEditorChat(reserved.appId).catch(() => ({ chatId: null }));
          const chat = existing.chatId ? this.ports.localChat?.(existing.chatId) : null;
          if (existing.chatId && chat) await this.settle(reserved, { outcome: "filled", chatId: existing.chatId, incarnationId: chat.incarnationId });
          continue;
        }
        if (first) firsts.set(first.command.commandId, reserved);
      } catch (error) { this.ports.report?.(error); }
    }
    this.firsts = firsts;
  }

  /** The reservation whose first message this delivered command is, as the last pass saw it; intake admits no other headless command. */
  reservedFirst(wire: Pick<EncryptedRemoteCommand, "commandId" | "chatId" | "incarnationId" | "intent">) {
    const reserved = this.firsts.get(wire.commandId);
    return reserved && reserved.chatId === wire.chatId && reserved.incarnationId === wire.incarnationId &&
      wire.intent?.creation === reserved.createOperationId ? reserved : null;
  }

  /**
   * The delivered first message becomes its App's first Edit Chat, under this very delivery's authority. Every refusal is sealed on the
   * reservation (so it never strands) and thrown as the closed reason intake reports: the App gone or uneditable, the App already holding an
   * Edit Chat (filled to it), the Agent not ready (§8.4.4), the Chat becoming an App. Filled to itself follows from the pass once it exists.
   */
  async materialise(command: RemoteCommand, context: RemoteContext, reserved: ReservedFirst, current: () => void) {
    const apps = this.ports.apps();
    if (!apps || !this.ports.submit || !command.intent) throw new Error("execution-not-ready");
    const available = apps.editorAvailability(reserved.appId);
    if (available.code) return this.refuse(reserved, available.code, "chat-not-executable");
    const existing = await apps.latestEditorChat(reserved.appId); current();
    const holder = existing.chatId ? this.ports.localChat?.(existing.chatId) : null;
    if (existing.chatId && holder) {
      await this.settle(reserved, { outcome: "filled", chatId: existing.chatId, incarnationId: holder.incarnationId });
      throw new Error("reservation-filled");
    }
    if (this.ports.agentReady && !await this.ports.agentReady(command.intent.baselineAgent)) return this.refuse(reserved, "agent-unavailable", "agent-unavailable");
    current();
    try { return await this.ports.submit(command, context, { appId: reserved.appId, projectId: available.projectId }, current); }
    catch (error) {
      if (error instanceof Error && error.message === "app-transitioning") return this.refuse(reserved, "app-transitioning", "app-transitioning");
      // Startup recovery refusing the first message is sealed under its own code, so the reservation never waits out its expiry admitting.
      if (error instanceof RecoveryPendingError) return this.refuse(reserved, error.code, error.code);
      throw error;
    }
  }

  private async refuse(reserved: ReservedFirst, code: Refusal, reason: string): Promise<never> {
    await this.settle(reserved, { outcome: "refused", code });
    throw new Error(reason);
  }
  private async settle(reserved: ReservedFirst, body: Parameters<typeof sealRemoteCreationSettlement>[1]) {
    if (!this.header) throw new Error("execution-not-ready");
    const settlement = await sealRemoteCreationSettlement(reserved.creation, body, this.ports.crypto());
    await this.ports.transport.mutate("remote/chats:settleReservation", { ...this.header, createOperationId: reserved.createOperationId, outcome: body.outcome, settlement });
    this.decided.add(reserved.createOperationId);
  }
}
