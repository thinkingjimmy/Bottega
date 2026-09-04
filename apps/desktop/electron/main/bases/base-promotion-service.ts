/**
 * [INPUT]: Depends on lifecycle AdmissionGate/IntentStore, BaseStore/owner resolver, conversation, critical area and event feedback
 * [OUTPUT]: Provides promote/promoteChild/recover, support top-level upgrades and Save as App gate-held subsidiaries
 * [POS]: The following is a list of the different types of promotional services available to users: Gate has intent, BaseStore only performs the local leaf steps
 */

import type {
  BasePromotionReceipt,
  BasesEvent,
} from "../../../shared/bases-ipc";
import type { AdmissionGate, SagaResult } from "../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import type { LifecycleIntent } from "../lifecycle/intent-types";
import type { BaseStore } from "./base-store";
import type { BaseOwnerResolver } from "./service/base-owner-resolver";
import { statusError } from "../errors";

type PromotionOptions = {
  runConversationExclusive<T>(
    chatId: string,
    task: () => Promise<T>
  ): Promise<T>;
  hasActiveTurn(chatId: string): boolean;
  onEvent(event: BasesEvent): void;
};

export class BasePromotionService {
  constructor(
    private readonly store: BaseStore,
    private readonly resolver: BaseOwnerResolver,
    private readonly intents: LifecycleIntentStore,
    private readonly gate: AdmissionGate,
    private readonly options: PromotionOptions
  ) {}

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
        const result = await this.options.runConversationExclusive(
          input.chatId,
          () => this.execute(intent)
        );
        if (result.status === "done" && result.value) {
          fromInstanceId = result.value.fromInstanceId;
        }
        return result;
      }
    );
    const receipt = receiptFromOutcome(outcome);
    if (outcome.state === "executed" && outcome.result.status === "done") {
      this.options.onEvent({
        type: "base-moved",
        from: {
          ownerKey: `chat:${input.chatId}`,
          ownerInstanceId: fromInstanceId,
        },
        to: {
          ownerKey: receipt.ownerKey,
          ownerInstanceId: receipt.ownerInstanceId,
        },
        revision: receipt.revision,
        reloadRequired: true,
      });
    }
    return receipt;
  }

  async recover(intent: LifecycleIntent): Promise<SagaResult> {
    const chatId = stringField(intent.input, "chatId");
    const projectId = stringField(intent.input, "projectId");
    const targetKey = `project:${projectId}`;
    const current = this.store.peek(targetKey);
    if (current?.meta.ownerInstanceId !== intent.intentId) {
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
  }): Promise<BasePromotionReceipt> {
    let child = await this.intents.createChild({
      parentIntentId: input.parent.intentId,
      linkKey: "promotionIntentId",
      kind: "base-promotion",
      requestId: input.requestId,
      input: { chatId: input.chatId, projectId: input.projectId },
    });
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
      this.options.onEvent({
        type: "base-moved",
        from: {
          ownerKey: `chat:${input.chatId}`,
          ownerInstanceId: source.incarnationId,
        },
        to: {
          ownerKey: receipt.ownerKey,
          ownerInstanceId: receipt.ownerInstanceId,
        },
        revision: receipt.revision,
        reloadRequired: true,
      });
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
    if (target && target.meta.ownerInstanceId !== intent.intentId) {
      return rejected("PROJECT_BASE_EXISTS", "Project 已有 Base");
    }
    try {
      await this.store.preparePromotion(
        chatId,
        projectId,
        intent.intentId
      );
      await this.intents.advance(intent.intentId, "project-written");
      const completed = await this.store.finalizePromotion(
        chatId,
        projectId,
        intent.intentId
      );
      return {
        status: "done",
        receipt: promotionReceipt(completed),
        value: {
          receipt: promotionReceipt(completed),
          fromInstanceId: source.meta.ownerInstanceId,
        },
      };
    } catch (cause) {
      if ((cause as { status?: number }).status === 409) {
        return rejected("PROMOTION_CONFLICT", errorText(cause));
      }
      throw cause;
    }
  }
}

function promotionReceipt(snapshot: {
  meta: { owner: import("../../../shared/bases-ipc").BaseOwner; ownerInstanceId: string; revision: number };
}): BasePromotionReceipt {
  return {
    ownerKey:
      snapshot.meta.owner.kind === "chat"
        ? `chat:${snapshot.meta.owner.chatId}`
        : `project:${snapshot.meta.owner.projectId}`,
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

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
