/**
 * [INPUT]: Depends on account-bound lifecycle intents, original SQLite classification candidates and the Save as App saga.
 * [OUTPUT]: Projects bounded pending conversion reviews and routes explicit hash-fenced keep-original decisions.
 * [POS]: Main conversion UI adapter; session state is checked on each read and decision.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema } from "@ai-chat/cloud-protocol/chats/classification";
import { sameScope } from "../../../../../shared/local-storage/contracts";
import { conversionReviewSchema, projectPromotionReviewSchema, projectRescueReviewSchema, type ConversionReview, type ProjectPromotionReview } from "../../../../../shared/cloud/conversion/model";
import type { ProjectRescueService } from "../../../projects/rescue/service";
import type { LifecycleIntent } from "../../../lifecycle/intent-types";
import type { BasePromotionService } from "../../../bases/base-promotion-service";
import type { SaveAsAppService } from "../../../apps/conversion/save-as-app";
import type { ChatStore } from "../../../chats/chat-store";
import type { LifecycleIntentStore } from "../../../lifecycle/intent-store";
import type { CloudAccountService } from "../../runtime/service";
import type { SyncBindingStore } from "../account/binding";
export class CloudConversionReview {
  constructor(private readonly ports: { environmentId: string; binding: SyncBindingStore; account: CloudAccountService;
    journal: LifecycleIntentStore; chats: ChatStore; service: SaveAsAppService; promotion?: BasePromotionService; rescue?: ProjectRescueService }) {}
  private scope(expectedUserId: string) {
    const binding = this.ports.binding.snapshot(), account = this.ports.account.snapshot();
    if (account.profile?.userId !== expectedUserId || !["ready", "temporarily-offline"].includes(account.status)) throw new Error("APP_PROMOTION_ACCOUNT_CHANGED");
    if (!binding) return null;
    if (binding.phase === "closing" || binding.userId !== expectedUserId || account.profile?.userId !== expectedUserId ||
      !["ready", "temporarily-offline"].includes(account.status)) throw new Error("APP_PROMOTION_ACCOUNT_CHANGED");
    return { environment: this.ports.environmentId, userId: expectedUserId };
  }
  private async pending(input: { expectedUserId: string; chatId: string }, kind: "save-as-app" | "base-promotion" | "project-chat-rescue", selected?: LifecycleIntent) {
    const scope = this.scope(input.expectedUserId);
    if (!scope) return null;
    const intent = selected ?? (await this.ports.journal.listPending()).find(item => item.kind === kind && !item.parentIntentId && item.input.chatId === input.chatId);
    if (!intent) return null;
    const savedScope = intent.recoveryState.cloudRescueScope ?? intent.recoveryState.cloudPromotionScope;
    if (savedScope && !sameScope(savedScope as typeof scope, scope)) throw new Error("APP_PROMOTION_ACCOUNT_CHANGED");
    const result = await this.ports.chats.sync.read(scope, { type: "classification", lifecycleOperationId: hashChatContent([kind, scope, intent.intentId]) });
    if (result.type !== "classification") throw new Error("APP_PROMOTION_REVIEW_UNAVAILABLE");
    const candidate = result.value, operation = candidate?.operation_json && chatClassificationOperationSchema.parse(JSON.parse(candidate.operation_json));
    const receipt = candidate?.receipt_json && chatClassificationReceiptSchema.parse(JSON.parse(candidate.receipt_json));
    this.scope(input.expectedUserId);
    return { intent, state: candidate?.state === "conflicted" ? "conflicted" : candidate?.state === "confirmed" || candidate?.state === "committed" ? "confirmed" : "pending",
      candidateHash: candidate?.candidate_hash ?? null, previous: operation ? operation.previous : null, proposed: operation ? operation.next : null,
      current: receipt ? receipt.head?.chat.classification ?? null : null };
  }
  async review(input: { expectedUserId: string; chatId: string }): Promise<ConversionReview | null> {
    const value = await this.pending(input, "save-as-app");
    if (!value) return null;
    const { intent, ...state } = value;
    return conversionReviewSchema.parse({ ...state, intentId: intent.intentId,
      input: { chatId: input.chatId, requestId: intent.requestId, name: intent.input.name, icon: intent.input.icon } });
  }
  async projectReview(input: { expectedUserId: string; chatId: string }): Promise<ProjectPromotionReview | null> {
    const value = await this.pending(input, "base-promotion");
    if (!value) return null;
    const { intent, ...state } = value;
    return projectPromotionReviewSchema.parse({ ...state, intentId: intent.intentId,
      input: { chatId: input.chatId, requestId: intent.requestId, projectId: intent.input.projectId } });
  }
  async keepProjectOriginal(input: { expectedUserId: string; chatId: string; intentId: string; candidateHash: string }) {
    const review = await this.projectReview(input);
    if (!review || review.intentId !== input.intentId || review.candidateHash !== input.candidateHash || review.state !== "conflicted" || !this.ports.promotion) throw new Error("BASE_PROMOTION_REVIEW_CHANGED");
    this.scope(input.expectedUserId);
    await this.ports.promotion.keepOriginal(input.intentId, input.candidateHash);
  }
  async rescueReview(input: { expectedUserId: string; projectId: string }) {
    if (!this.scope(input.expectedUserId)) return null;
    const pending = (await this.ports.journal.listPending()).filter(intent => intent.kind === "project-chat-rescue" && intent.input.projectId === input.projectId);
    const items = [];
    for (const intent of pending.slice(0, 50)) {
      const chatId = String(intent.input.chatId), value = await this.pending({ expectedUserId: input.expectedUserId, chatId }, "project-chat-rescue", intent);
      if (!value) continue;
      const { intent: _intent, ...state } = value;
      items.push({ ...state, intentId: intent.intentId, title: this.ports.chats.getMetadata(chatId)?.title?.slice(0, 512) ?? "",
        input: { chatId, requestId: intent.requestId, projectId: input.projectId } });
    }
    this.scope(input.expectedUserId);
    return projectRescueReviewSchema.parse({ items, hasMore: pending.length > 50 });
  }
  async keepRescueOriginal(input: { expectedUserId: string; chatId: string; intentId: string; candidateHash: string }) {
    const review = await this.pending(input, "project-chat-rescue");
    if (!review || review.intent.intentId !== input.intentId || review.candidateHash !== input.candidateHash || review.state !== "conflicted" || !this.ports.rescue) throw new Error("PROJECT_RESCUE_REVIEW_CHANGED");
    this.scope(input.expectedUserId);
    await this.ports.rescue.keepOriginal(input.intentId, input.candidateHash);
  }
  async keepOriginal(input: { expectedUserId: string; chatId: string; intentId: string; candidateHash: string }) {
    const review = await this.review(input);
    if (!review || review.intentId !== input.intentId || review.candidateHash !== input.candidateHash || review.state !== "conflicted") throw new Error("APP_PROMOTION_REVIEW_CHANGED");
    this.scope(input.expectedUserId);
    await this.ports.service.keepOriginal(input.intentId, input.candidateHash);
  }
}
