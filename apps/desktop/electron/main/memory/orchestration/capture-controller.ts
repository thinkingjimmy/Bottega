/**
 * [INPUT]: Depends on settled frozen admission, canonical Chat, positive provider proof, Policy fence, Delivery reservation and network runtime
 * [OUTPUT]: Provides live/rebuild two explicit capability capture; Each provider attempt has a target-backed reservation and a stable payload/turn id
 * [POS]: The main/memory/orchestration capture executor; The authorization and the water level are held by Policy/Delivery, and this document lists only side effects of single wheels
 */

import type { ChatRecord } from "../../../../shared/chats-ipc";
import type { AssistantChatMessage, UserChatMessage } from "../../../../shared/chats-ipc";
import type { MemoryPrePromptValidation } from "../core/domain";
import type { FrozenTurnMemoryContext } from "../core/domain";
import type { MemoryProvider } from "../core/provider";
import { providerSessionRef } from "../core/session-ref";
import { MemoryDeliveryStore, stableMemoryPayloadId } from "../delivery/store";
import { isMemorableAssistant } from "../core/domain";
import type { MemoryTurnSettledEvent } from "../service/memory-state";
import type { MemoryNetworkRuntime } from "../runtime/network-runtime";
import { memorySpaceGate } from "../space-gate";

export type TrustedProviderProof = Readonly<{
  controlGeneration: number;
  provider: MemoryProvider;
  providerDataInstanceId: string;
  policyRevision: number;
  revocationRevision: number;
}>;

type Dependencies = {
  delivery: MemoryDeliveryStore;
  network: MemoryNetworkRuntime;
  readChat(chatId: string): Promise<ChatRecord | null>;
  trustedProviderReady(context: FrozenTurnMemoryContext): Promise<TrustedProviderProof>;
  trustedRebuildProviderReady(
    context: FrozenTurnMemoryContext
  ): Promise<TrustedProviderProof>;
  validateContext(context: FrozenTurnMemoryContext): MemoryPrePromptValidation;
  validateFrozen(context: FrozenTurnMemoryContext, proof: TrustedProviderProof): boolean;
  validateRebuildFrozen(
    context: FrozenTurnMemoryContext,
    proof: TrustedProviderProof
  ): boolean;
  providerId(): string;
  captured(): void;
};

export class MemoryCaptureController {
  constructor(private readonly dependencies: Dependencies) {}

  async settle(event: MemoryTurnSettledEvent, memoryAuthorized: boolean) {
    if (
      !memoryAuthorized ||
      event.outcome !== "stored" ||
      event.origin?.kind !== "manual" ||
      event.planRequested
    ) return;
    const admission = event.context?.memory;
    if (!admission || admission.kind !== "eligible") return;
    const context = admission.context;
    if (this.dependencies.validateContext(context).kind !== "allowed") return;
    const chat = await this.dependencies.readChat(event.conversationId);
    const assistant = chat?.messages.find(
      (message): message is AssistantChatMessage =>
        message.id === event.assistantMessageId && message.role === "assistant"
    );
    if (!chat || !assistant || !isMemorableAssistant(assistant)) return;
    const user = chat.messages
      .filter(
        (message): message is UserChatMessage =>
          message.role === "user" && message.seq < assistant.seq
      )
      .at(-1);
    if (!user) return;
    await this.captureCanonical({
      context,
      requestId: event.requestId,
      user,
      assistant,
    });
  }

  async captureCanonical(input: Readonly<{
    context: FrozenTurnMemoryContext;
    requestId: string;
    user: UserChatMessage;
    assistant: AssistantChatMessage;
    grantId?: string;
    mode?: "rebuild";
  }>) {
    const { context, user, assistant } = input;
    if (
      !input.mode &&
      this.dependencies.validateContext(context).kind !== "allowed"
    ) return false;
    const proof = await (input.mode
      ? this.dependencies.trustedRebuildProviderReady(context)
      : this.dependencies.trustedProviderReady(context));
    const validate = input.mode
      ? this.dependencies.validateRebuildFrozen
      : this.dependencies.validateFrozen;
    const ref = providerSessionRef({
      sessionKey: `${context.memorySpaceId}:${context.sourceSessionKey}`,
      workspacePeerId: context.expectedPeerId,
    });
    const reservation = await memorySpaceGate.run(context.memorySpaceId, () => {
      if (!validate(context, proof)) {
        throw new Error("Memory capability 已撤销");
      }
      return this.dependencies.delivery.reserveCapture({
        providerDataInstanceId: context.providerDataInstanceId,
        providerId: this.dependencies.providerId(),
        memorySpaceId: context.memorySpaceId,
        sourceSessionKey: context.sourceSessionKey,
        grantId: input.grantId ?? null,
        assistantSeq: assistant.seq,
        expectedPeerId: context.expectedPeerId,
        remoteSessionId: ref.remoteSessionId,
        attemptId: `${input.requestId}:${assistant.seq}:${input.grantId ?? "live"}`,
        policyRevision: context.policyRevision,
        revocationRevision: context.revocationRevision,
        allowQuiesced: input.mode === "rebuild",
      });
    });
    if (reservation.state !== "active") {
      return reservation.state === "completed";
    }
    let terminal: "completed" | "rejected" | "cancelled" = "rejected";
    try {
      const completed = await this.dependencies.network.run(async (signal) => {
        if (!validate(context, proof)) return false;
        await proof.provider.ensureSession(ref, { signal });
        if (!validate(context, proof)) return false;
        const payloadId = stableMemoryPayloadId({
          providerDataInstanceId: context.providerDataInstanceId,
          memorySpaceId: context.memorySpaceId,
          sourceSessionKey: context.sourceSessionKey,
          assistantSeq: assistant.seq,
        });
        await proof.provider.capture(ref, {
          signal,
          payloadId,
          turnId: input.requestId,
          messages: [
            { role: "user", content: user.content, createdAt: user.createdAt },
            { role: "assistant", content: assistant.content, createdAt: assistant.createdAt },
          ],
        });
        if (!validate(context, proof)) return false;
        await proof.provider.commit(ref, { signal });
        if (!validate(context, proof)) return false;
        await this.dependencies.delivery.recordDelivered({
          providerDataInstanceId: context.providerDataInstanceId,
          providerId: this.dependencies.providerId(),
          memorySpaceId: context.memorySpaceId,
          sourceSessionKey: context.sourceSessionKey,
          assistantSeq: assistant.seq,
          grantId: input.grantId ?? null,
        });
        this.dependencies.captured();
        return true;
      });
      terminal = completed ? "completed" : "rejected";
    } finally {
      await this.dependencies.delivery.finishReservation(
        context.providerDataInstanceId,
        reservation.id,
        terminal
      );
    }
    return terminal === "completed";
  }
}
