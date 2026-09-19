/**
 * [INPUT]: Depends on lifecycle AdmissionGate/IntentStore, BaseStore/owner resolver, the shared ownerKeyOf projection, conversation exclusivity, and main/errors
 * [OUTPUT]: Provides local or confirmed cloud promotion, remote ownership adoption and roll-forward recovery.
 * [POS]: Base promotion saga; the existing intent journal and Store envelope preserve original IDs and transfer evidence.
 */

import { type BaseMeta, type BasePromotionReceipt, type BasesEvent } from "../../../shared/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-ui/model/owner-key";
import type { AdmissionGate, SagaResult } from "../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import type { LifecycleIntent } from "../lifecycle/intent-types";
import type { BaseStore } from "./base-store";
import type { BaseOwnerResolver } from "./service/base-owner-resolver";
import { errorMessage, statusError } from "../errors";
import { confirmedBasePromotionSchema, type ConfirmedBasePromotion } from "./store/promotion/cloud";
import { preservedConversion, type ConversionScopeCleanup } from "../lifecycle/scope-cleanup/conversion";
import { remoteBaseTransferIdentitySchema, type RemoteBasePromotion } from "./store/promotion/remote";
import { createHash } from "node:crypto";
import { CloudPromotionDelivery, type ProjectBasePromotion } from "./store/promotion/port";
import { canonicalJson } from "../../../shared/local-storage/contracts";

type PromotionOptions = {
  runProjectExclusive?<T>(task: () => Promise<T>): Promise<T>;
  runConversationExclusive<T>(
    chatId: string,
    task: () => Promise<T>
  ): Promise<T>;
  hasActiveTurn(chatId: string): boolean;
  onEvent(event: BasesEvent): void;
};

export class BasePromotionService {
  private cloud: ProjectBasePromotion | null = null;
  constructor(
    private readonly store: BaseStore,
    private readonly resolver: BaseOwnerResolver,
    private readonly intents: LifecycleIntentStore,
    private readonly gate: AdmissionGate,
    private readonly options: PromotionOptions
  ) {}

  attachCloud(cloud: ProjectBasePromotion) {
    if (this.cloud) throw new Error("CLOUD_PROMOTION_ALREADY_ATTACHED");
    this.cloud = cloud;
  }
  settleScopeCleanup(intentId: string, cleanup: ConversionScopeCleanup) {
    return this.gate.runRecovery(intentId, async original => {
      if (original.kind !== "base-promotion" || original.parentIntentId) throw new Error("CONVERSION_CLEANUP_INTENT_CHANGED");
      const decision = await cleanup.prepare(original);
      if (original.recoveryState.remoteBaseTransfer) {
        if (decision.disposition === "preserve") { await cleanup.release(original); return preservedConversion(); }
        const result = await this.runRemote(original);
        if (result.status !== "done") return result;
        return { ...result, receipt: { ...result.receipt, ...decision.receipt } };
      }
      const chatId = stringField(original.input, "chatId"), projectId = stringField(original.input, "projectId");
      const execute = () => this.options.runConversationExclusive(chatId, async (): Promise<SagaResult> => {
        if (this.options.hasActiveTurn(chatId)) throw new Error("CONVERSION_CLEANUP_ACTIVE_TURN");
        if (decision.disposition === "preserve") { await cleanup.release(original); return preservedConversion(); }
        else {
          if (!decision.proof) throw new Error("CONVERSION_CLEANUP_PROOF_REQUIRED");
          await cleanup.commit(original);
          await this.store.preparePromotion(chatId, projectId, original.intentId, decision.proof);
          const snapshot = await this.store.finalizePromotion(chatId, projectId, original.intentId);
          return { status: "done", receipt: { ...decision.receipt, ...promotionReceipt(snapshot) } };
        }
      });
      return this.options.runProjectExclusive ? this.options.runProjectExclusive(execute) : execute();
    });
  }
  async recoverPending() {
    const errors: unknown[] = [];
    for (const intent of await this.intents.listPending()) {
      if (intent.kind !== "base-promotion" || intent.parentIntentId || !intent.recoveryState.cloudPromotionScope) continue;
      try { await this.gate.runRecovery(intent.intentId, next => this.recover(next)); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Some Base promotions still require recovery");
  }
  async keepOriginal(intentId: string, candidateHash: string) {
    await this.gate.runRecovery(intentId, async intent => {
      if (intent.kind !== "base-promotion" || intent.parentIntentId || !intent.recoveryState.cloudPromotionScope || !this.cloud) throw new Error("BASE_PROMOTION_REVIEW_CHANGED");
      await this.cloud.discard(intent, candidateHash, async () => { await this.intents.advance(intent.intentId, intent.phase, { cloudKeepOriginal: candidateHash }); });
      return rejected("BASE_PROMOTION_DISCARDED", "The original Chat Base was kept.");
    });
  }
  private async run(intent: LifecycleIntent): Promise<SagaResult<{ receipt: BasePromotionReceipt; fromInstanceId: string }>> {
    if (intent.recoveryState.scopeCleanup) throw new Error("CONVERSION_SCOPE_CLEANUP_REQUIRED");
    const chatId = stringField(intent.input, "chatId"), projectId = stringField(intent.input, "projectId");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const execute = () => this.options.runConversationExclusive(chatId, async () => {
          if (intent.recoveryState.cloudKeepOriginal) {
            if (!this.cloud) throw new Error("CLOUD_PROMOTION_RUNTIME_PENDING");
            await this.cloud.discard(intent, stringField(intent.recoveryState, "cloudKeepOriginal"), async () => {});
            return rejected("BASE_PROMOTION_DISCARDED", "The original Chat Base was kept.");
          }
          if (this.options.hasActiveTurn(chatId)) {
            if (intent.recoveryState.cloudPromotionScope) throw statusError(409, "The Chat still has an active turn.");
            return rejected("ACTIVE_TURN", "The Chat still has an active turn.");
          }
          const source = this.store.get(`chat:${chatId}`);
          if (!this.cloud && (intent.recoveryState.cloudPromotionScope || source && this.store.sync.read(`chat:${chatId}`, source.meta.ownerInstanceId).scope)) throw new Error("CLOUD_PROMOTION_RUNTIME_PENDING");
          let proof = cloudProof(intent);
          if (!proof) {
            proof = await this.cloud?.prepare({ intent, chatId, projectId }) ?? undefined;
            if (proof) intent = await this.intents.advance(intent.intentId, intent.phase, { cloudPromotion: proof });
          }
          if (proof) {
            if (!this.cloud) throw new Error("CLOUD_PROMOTION_RUNTIME_PENDING");
            await this.cloud.commit(proof);
          }
          const promoted = this.store.promotedSnapshot(projectId, intent.intentId);
          if (promoted) {
            const completed = await this.store.finalizePromotion(chatId, projectId, intent.intentId), receipt = promotionReceipt(completed);
            return { status: "done" as const, receipt, value: { receipt, fromInstanceId: proof?.operation.incarnationId ?? promoted.meta.ownerInstanceId } };
          }
          return this.execute(intent);
        });
        return await (this.options.runProjectExclusive ? this.options.runProjectExclusive(execute) : execute());
      } catch (error) {
        if (!(error instanceof CloudPromotionDelivery) || attempt > 0) throw error;
        await error.deliver();
        const next = await this.intents.getById(intent.intentId);
        if (!next || next.terminal) throw new Error("BASE_PROMOTION_INTENT_CHANGED");
        intent = next;
      }
    }
    throw new Error("BASE_PROMOTION_DELIVERY_PENDING");
  }

  async promote(input: {
    chatId: string;
    requestId: string;
  }): Promise<BasePromotionReceipt> {
    const chat = await this.resolver.chat(input.chatId);
    if (!chat.projectId) throw statusError(409, "当前 chat 尚未加入 Project");
    const projectId = chat.projectId;
    await this.resolver.identityForOwnerKey(`project:${projectId}`);
    let fromInstanceId = chat.incarnationId;
    const outcome = await this.gate.admitAndRun(
      {
        kind: "base-promotion",
        requestId: input.requestId,
        input: { chatId: input.chatId, projectId },
      },
      async (intent) => {
        const result = await this.run(intent);
        if (result.status === "done" && result.value) {
          fromInstanceId = result.value.fromInstanceId;
        }
        return result;
      }
    );
    const receipt = receiptFromOutcome(outcome);
    if (outcome.state === "executed" && outcome.result.status === "done") {
      this.emitMoved(input.chatId, fromInstanceId, receipt);
    }
    return receipt;
  }

  async acceptRemote(input: { chatId: string; projectId: string; baseId: string; snapshot: RemoteBasePromotion }) {
    const identity = remoteBaseTransferIdentitySchema.parse({ scope: input.snapshot.scope, baseId: input.baseId });
    const existing = this.store.get(`chat:${input.chatId}`) ?? this.store.get(`project:${input.projectId}`);
    if (!existing || existing.meta.ownerInstanceId !== identity.baseId || input.snapshot.confirmed.meta.ownerInstanceId !== identity.baseId ||
        canonicalJson(this.store.sync.read(ownerKeyOf(existing.meta.owner), identity.baseId).scope) !== canonicalJson(identity.scope)) throw new Error("REMOTE_BASE_TRANSFER_SCOPE_CHANGED");
    const requestId = createHash("sha256").update(canonicalJson(["remote-base-transfer", identity, input.chatId, input.projectId])).digest("hex");
    const outcome = await this.gate.admitAndRun({ kind: "base-promotion", requestId, input: { chatId: input.chatId, projectId: input.projectId } }, async intent => {
      if (intent.recoveryState.remoteBaseTransfer && canonicalJson(intent.recoveryState.remoteBaseTransfer) !== canonicalJson(identity)) throw new Error("REMOTE_BASE_TRANSFER_CHANGED");
      if (!intent.recoveryState.remoteBaseTransfer) intent = await this.intents.advance(intent.intentId, intent.phase, { remoteBaseTransfer: identity });
      return this.runRemote(intent, input.snapshot);
    });
    return receiptFromOutcome(outcome);
  }
  private async runRemote(intent: LifecycleIntent, snapshot?: RemoteBasePromotion): Promise<SagaResult> {
    const identity = remoteBaseTransferIdentitySchema.parse(intent.recoveryState.remoteBaseTransfer);
    const chatId = stringField(intent.input, "chatId"), projectId = stringField(intent.input, "projectId");
    const execute = () => this.options.runConversationExclusive(chatId, async () => {
      const target = this.store.promotedSnapshot(projectId, intent.intentId), source = this.store.get(`chat:${chatId}`);
      const current = target ?? source;
      if (!current || current.meta.ownerInstanceId !== identity.baseId) throw new Error("REMOTE_BASE_TRANSFER_CHANGED");
      const ownerKey = ownerKeyOf(current.meta.owner), scope = this.store.sync.read(ownerKey, identity.baseId).scope;
      if (canonicalJson(scope) !== canonicalJson(identity.scope) || snapshot && canonicalJson(snapshot.scope) !== canonicalJson(identity.scope)) throw new Error("REMOTE_BASE_TRANSFER_SCOPE_CHANGED");
      if (!target) await this.store.prepareRemotePromotion(chatId, projectId, intent.intentId, snapshot);
      await this.intents.advance(intent.intentId, "project-written");
      const completed = await this.store.finalizePromotion(chatId, projectId, intent.intentId), receipt = promotionReceipt(completed);
      this.emitMoved(chatId, identity.baseId, receipt);
      return { status: "done" as const, receipt };
    });
    return this.options.runProjectExclusive ? this.options.runProjectExclusive(execute) : execute();
  }
  async recover(intent: LifecycleIntent): Promise<SagaResult> {
    if (intent.recoveryState.scopeCleanup) throw new Error("CONVERSION_SCOPE_CLEANUP_REQUIRED");
    if (intent.recoveryState.remoteBaseTransfer) return this.runRemote(intent);
    if (!intent.parentIntentId && intent.recoveryState.cloudPromotionScope) {
      const result = await this.run(intent);
      if (result.status === "done" && result.value) this.emitMoved(stringField(intent.input, "chatId"), result.value.fromInstanceId, result.value.receipt);
      return result;
    }
    const chatId = stringField(intent.input, "chatId");
    const projectId = stringField(intent.input, "projectId");
    const cloud = cloudProof(intent);
    if (cloud && !this.store.promotedSnapshot(projectId, intent.intentId)) await this.store.preparePromotion(chatId, projectId, intent.intentId, cloud);
    if (!this.store.promotedSnapshot(projectId, intent.intentId)) {
      await this.store.rollbackPromotion(projectId, intent.intentId);
      return {
        status: "business-rejected",
        error: {
          code: "PROMOTION_ROLLED_BACK",
          message: "Project Base 提交不完整，已保留原 Chat Base",
        },
      };
    }
    const snapshot = await this.store.finalizePromotion(
      chatId,
      projectId,
      intent.intentId
    );
    return {
      status: "done",
      receipt: promotionReceipt(snapshot),
    };
  }

  /**
   * Save as App 已持有 chat+project claim 与 conversation 门闩；子 intent
   * 只落同一 journal，不再进入 AdmissionGate，避免反向重入。
   */
  async promoteChild(input: {
    parent: LifecycleIntent;
    chatId: string;
    projectId: string;
    requestId: string;
    cloud?: ConfirmedBasePromotion;
  }): Promise<BasePromotionReceipt> {
    let child = await this.intents.createChild({
      parentIntentId: input.parent.intentId,
      linkKey: "promotionIntentId",
      kind: "base-promotion",
      requestId: input.requestId,
      input: { chatId: input.chatId, projectId: input.projectId },
    });
    if (input.cloud) {
      const proof = confirmedBasePromotionSchema.parse(input.cloud), previous = cloudProof(child);
      if (previous && canonicalJson(previous) !== canonicalJson(proof)) throw new Error("Base promotion proof changed");
      if (!previous) child = await this.intents.advance(child.intentId, child.phase, { cloudPromotion: proof });
    }
    if (input.parent.phase === "chat-migrated") {
      await this.intents.advance(
        input.parent.intentId,
        "promotion-created"
      );
    }
    if (child.terminal) {
      if (child.terminal.status === "done" && child.terminal.receipt) {
        return child.terminal.receipt as BasePromotionReceipt;
      }
      throw statusError(
        409,
        child.terminal.error?.message ?? "Base 子升级已回滚"
      );
    }
    if (child.phase === "proposed") {
      child = await this.intents.advance(child.intentId, "pending");
    }
    const source = await this.resolver.chat(input.chatId);
    const result =
      child.phase === "project-written"
        ? await this.recover(child)
        : await this.execute(child);
    if (result.status === "done" && result.receipt) {
      await this.intents.settle(child.intentId, {
        status: "done",
        receipt: result.receipt,
      });
      const receipt = result.receipt as BasePromotionReceipt;
      this.emitMoved(input.chatId, source.incarnationId, receipt);
      return receipt;
    }
    if (result.status === "business-rejected") {
      await this.intents.settle(child.intentId, {
        status: "rolled-back",
        error: result.error,
      });
      throw statusError(409, result.error.message);
    }
    throw new Error("Base 子升级被中断，将在启动时恢复");
  }

  private emitMoved(
    chatId: string,
    fromInstanceId: string,
    receipt: BasePromotionReceipt
  ) {
    this.options.onEvent({
      type: "base-moved",
      from: { ownerKey: `chat:${chatId}`, ownerInstanceId: fromInstanceId },
      to: { ownerKey: receipt.ownerKey, ownerInstanceId: receipt.ownerInstanceId },
      revision: receipt.revision,
      reloadRequired: true,
    });
  }

  private async execute(
    intent: LifecycleIntent
  ): Promise<
    SagaResult<{ receipt: BasePromotionReceipt; fromInstanceId: string }>
  > {
    const chatId = stringField(intent.input, "chatId");
    const projectId = stringField(intent.input, "projectId");
    if (this.options.hasActiveTurn(chatId)) {
      return rejected("ACTIVE_TURN", "当前 chat 仍有活动 turn，不能升级 Base");
    }
    const chat = await this.resolver.chat(chatId);
    if (chat.projectId !== projectId) {
      return rejected("PROJECT_CHANGED", "chat 的 Project 归属已变化");
    }
    const source = this.store.get(`chat:${chatId}`, chat.incarnationId);
    if (!source) {
      return rejected("BASE_NOT_OWNED", "当前 chat 没有自有 Base 可升级");
    }
    const target = this.store.get(`project:${projectId}`);
    const cloud = cloudProof(intent);
    if (target && !this.store.promotedSnapshot(projectId, intent.intentId)) {
      return rejected("PROJECT_BASE_EXISTS", "Project 已有 Base");
    }
    try {
      await this.store.preparePromotion(
        chatId,
        projectId,
        intent.intentId,
        cloud
      );
      await this.intents.advance(intent.intentId, "project-written");
      const completed = await this.store.finalizePromotion(
        chatId,
        projectId,
        intent.intentId
      );
      const receipt = promotionReceipt(completed);
      return {
        status: "done",
        receipt,
        value: { receipt, fromInstanceId: source.meta.ownerInstanceId },
      };
    } catch (cause) {
      if (!cloud && (cause as { status?: number }).status === 409) {
        return rejected("PROMOTION_CONFLICT", errorMessage(cause));
      }
      throw cause;
    }
  }
}

function cloudProof(intent: LifecycleIntent) {
  const proof = intent.recoveryState.cloudPromotion;
  return proof === undefined ? undefined : confirmedBasePromotionSchema.parse(proof);
}

function promotionReceipt(snapshot: {
  meta: Pick<BaseMeta, "owner" | "ownerInstanceId" | "revision">;
}): BasePromotionReceipt {
  return {
    ownerKey: ownerKeyOf(snapshot.meta.owner),
    ownerInstanceId: snapshot.meta.ownerInstanceId,
    revision: snapshot.meta.revision,
  };
}

function receiptFromOutcome(
  outcome: Awaited<ReturnType<AdmissionGate["admitAndRun"]>>
) {
  const receipt =
    outcome.state === "settled"
      ? outcome.receipt
      : outcome.result.status === "done"
        ? outcome.result.receipt
        : undefined;
  if (receipt) return receipt as BasePromotionReceipt;
  const message =
    outcome.state === "settled"
      ? outcome.error?.message
      : outcome.result.status === "business-rejected"
        ? outcome.result.error.message
        : "Base 升级未完成，将在启动时恢复";
  throw statusError(409, message ?? "Base 升级失败");
}

function rejected(code: string, message: string) {
  return {
    status: "business-rejected" as const,
    error: { code, message },
  };
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "string" || !field) {
    throw new Error(`base-promotion intent 缺少 ${key}`);
  }
  return field;
}
