/**
 * [INPUT]: Depends on RelayLedger, ChatService, SettingsStore, Keyless Universal Workspace lifecycle gate, notice outbox, backend readiness and create-section saga
 * [OUTPUT]: Provides access to and feedback from tools such as send_to_section / create_section / promote; promote with original parameters abstract and complete D-D6 provenance Atomic entry, return to execute the entire line by book intent Projection, Project inheritance qualification review, Intent entry and first creation of a common gate
 * [POS]: The builtin tool of sections/coordinator is to access the boundary; The controller only receives verified durable relay/create intent
 */

import { createHash } from "node:crypto";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import type { UnsequencedUserMessage } from "../../../../../shared/chats-ipc";
import type { SettingsStore } from "../../../settings-store";
import type { ChatsService } from "../../../chats/chats-service";
import { backendById } from "../../../backends";
import { assertSectionBackendReady } from "../../backend-access";
import type { BuiltinToolContext } from "../../../tools/registry";
import {
  rootChainId,
  sectionRef,
  stableId,
} from "../coordinator-values";
import { SectionNoticeOutbox } from "../notice-outbox";
import { RelayLedger, type CreateIntent } from "../relay-ledger";
import { resumeCreateSectionSaga } from "../sagas/create-section";

export type RelayToolStatus = {
  status: "started" | "queued" | "paused" | "rejected" | "failed";
  detail?: string;
};

type Dependencies = {
  ledger: RelayLedger;
  chats: ChatsService;
  settings: SettingsStore;
  notices: SectionNoticeOutbox;
  accepting(): boolean;
  isConversationAvailable?(conversationId: string): boolean;
  isExternalProject?(projectId: string): boolean;
  withWorkspaceLifecycle?<T>(task: () => Promise<T>): Promise<T>;
  hasActivity(conversationIds: Iterable<string>): boolean;
  kick(conversationId: string): void;
};

type PromoteProvenance = Extract<
  CreateIntent,
  { mode: "seed" }
>["promotedFrom"];

type PromoteInput = {
  agentThreadId: string;
  messages: string[];
  title?: string;
  agent?: string;
  inheritProject?: boolean;
  note?: string;
  promotedFrom: PromoteProvenance;
};

export class SectionToolAdmission {
  constructor(private readonly dependencies: Dependencies) {}

  async send(
    input: { sectionId: string; message: string; expectReply: boolean },
    context: BuiltinToolContext
  ): Promise<RelayToolStatus> {
    if (!this.dependencies.accepting()) {
      return { status: "rejected", detail: "接力服务正在关闭" };
    }
    if (input.sectionId === context.lease.chatId) {
      return {
        status: "rejected",
        detail: "不能向当前 Section 发送；请直接回答",
      };
    }
    if (
      this.dependencies.isConversationAvailable &&
      !this.dependencies.isConversationAvailable(input.sectionId)
    ) {
      return { status: "failed", detail: "ARCHIVED" };
    }
    try {
      /* relay 是另一条能把消息塞进任意 chat 的路径；guard 若只挡 renderer，
         一个普通 Agent 就能用 send_to_section 绕过去。 */
      this.dependencies.chats.assertOrdinaryTurnAllowed(input.sectionId);
      const [source, target] = await Promise.all([
        this.dependencies.chats.store.get(context.lease.chatId),
        this.dependencies.chats.store.get(input.sectionId),
      ]);
      if (!source || !target) {
        return { status: "rejected", detail: "来源或目标 Section 不存在" };
      }
      await assertSectionBackendReady(target.agent);
      const id = stableId(
        "relay",
        `${context.lease.leaseId}:${context.invocationId}`
      );
      const relay = await this.dependencies.ledger.enqueueRelay({
        id,
        rootChainId: rootChainId(context),
        source: sectionRef(source),
        target: sectionRef(target),
        message: input.message,
        expectReply: input.expectReply,
        createdAt: Date.now(),
        requestId: stableId("request", id),
        userMessageId: stableId("user", id),
        assistantMessageId: stableId("assistant", id),
        limit: this.dependencies.settings.get().autoRelayLimit,
      });
      if (relay.reservationState === "waiting") {
        await this.dependencies.notices.appendPause(relay);
        return {
          status: "paused",
          detail: "自动接力已达到链路预算，等待用户继续",
        };
      }
      const active = this.dependencies.hasActivity([target.id]);
      this.dependencies.kick(target.id);
      return {
        status: active ? "queued" : "started",
        ...(active ? { detail: "目标 Section 正忙，已按 FIFO 排队" } : {}),
      };
    } catch (cause) {
      return {
        status: "rejected",
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  async create(
    input: {
      firstMessage: string;
      title?: string;
      agent?: string;
      inheritProject?: boolean;
      contextSectionIds: string[];
    },
    context: BuiltinToolContext
  ): Promise<{
    section_id: string;
    first_turn: "started" | "paused" | "rejected" | "idle";
    detail?: string;
  }> {
    const intentId = stableId(
      "intent",
      `${context.lease.leaseId}:${context.invocationId}`
    );
    const known = this.dependencies.ledger.snapshot().createIntents[intentId];
    if (known) return this.resumeToolResult(intentId);
    const source = await this.dependencies.chats.store.get(
      context.lease.chatId
    );
    if (!source) {
      return { section_id: "", first_turn: "rejected" };
    }
    const agent = (input.agent ?? source.agent) as AgentBackendId;
    try {
      backendById(agent);
      const projectId = input.inheritProject ? source.projectId : null;
      if (input.inheritProject && !projectId) {
        throw new Error(
          "inherit_project 只允许继承当前 Section 自己的 external-bound Project"
        );
      }
      const contextIds = [...new Set([
        source.id,
        ...input.contextSectionIds,
      ])];
      if (contextIds.length > 8) {
        throw new Error("来源 Section 与 context_section_ids 去重后最多 8 个");
      }
      const contextRecords = await Promise.all(
        contextIds.map((id) => this.dependencies.chats.store.get(id))
      );
      if (contextRecords.some((record) => !record)) {
        throw new Error("context_section_ids 中有 Section 不存在");
      }
      await assertSectionBackendReady(agent);
      const sectionId = stableId("section", intentId);
      const incarnationId = createHash("sha256")
        .update(`incarnation:${intentId}`)
        .digest("hex")
        .slice(0, 32);
      const relayId = stableId("relay", intentId);
      const createdAt = Date.now();
      const firstMessage: UnsequencedUserMessage = {
        id: stableId("user", intentId),
        role: "user",
        content: input.firstMessage,
        createdAt,
        relay: {
          sourceSectionId: source.id,
          chainId: rootChainId(context),
        },
      };
      const admit = async (projectAdmissionHeld = false) => {
        if (projectId) {
          const liveSource = await this.dependencies.chats.store.get(source.id);
          if (
            liveSource?.incarnationId !== source.incarnationId ||
            liveSource.projectId !== projectId ||
            !this.dependencies.isExternalProject?.(projectId)
          ) {
            throw new Error(
              "inherit_project 只允许继承当前 Section 自己的 external-bound Project"
            );
          }
        }
        await this.dependencies.ledger.putCreateIntentAndRelay(
          {
            mode: "run",
            id: intentId,
            sectionId,
            incarnationId,
            firstMessageId: firstMessage.id,
            relayId,
            source: sectionRef(source),
            rootChainId: rootChainId(context),
            firstMessage: input.firstMessage,
            ...(input.title ? { title: input.title } : {}),
            agent,
            ...(projectId ? { projectId } : {}),
            contextSections: contextRecords.map((record) =>
              sectionRef(record!)
            ),
            createdAt,
            sagaPhase: "validated",
          },
          {
            id: relayId,
            rootChainId: rootChainId(context),
            source: sectionRef(source),
            target: { chatId: sectionId, incarnationId },
            message: input.firstMessage,
            expectReply: false,
            createdAt,
            requestId: stableId("request", relayId),
            userMessageId: firstMessage.id,
            assistantMessageId: stableId("assistant", relayId),
            limit: this.dependencies.settings.get().autoRelayLimit,
          }
        );
        return this.resumeToolResult(intentId, projectAdmissionHeld);
      };
      if (!projectId) return await admit();
      if (!this.dependencies.withWorkspaceLifecycle) {
        throw new Error("Project lifecycle gate 不可用，拒绝继承 Project");
      }
      return await this.dependencies.withWorkspaceLifecycle(() =>
        admit(true)
      );
    } catch (cause) {
      const snapshot =
        this.dependencies.ledger.snapshot().createIntents[intentId];
      return {
        section_id: snapshot?.sectionId ?? "",
        first_turn: "rejected",
        detail: snapshot
          ? `CreateIntent 已安全入账，可用同一调用重试或由启动恢复：${
              cause instanceof Error ? cause.message : String(cause)
            }`
          : cause instanceof Error
            ? cause.message
            : String(cause),
      };
    }
  }

  async promote(
    input: PromoteInput,
    context: BuiltinToolContext
  ): Promise<{
    section_id: string;
    first_turn: "idle" | "rejected";
    detail?: string;
    promotedFrom: PromoteProvenance;
  }> {
    const intentId = stableId(
      "intent",
      `${context.lease.leaseId}:promote:${input.agentThreadId}`
    );
    const admitted = await this.admitPromotion(intentId, input, context);
    /* 回执整条只认账本那一条 intent：replay 命中时 section_id 来自上次入
       账，字节账与 truncated 若取本次取材，一次调用就同时说了两件事。 */
    const intent = this.dependencies.ledger.snapshot().createIntents[intentId];
    return {
      ...admitted,
      promotedFrom:
        intent?.mode === "seed" ? intent.promotedFrom : input.promotedFrom,
    };
  }

  private async admitPromotion(
    intentId: string,
    input: PromoteInput,
    context: BuiltinToolContext
  ): Promise<{
    section_id: string;
    first_turn: "idle" | "rejected";
    detail?: string;
  }> {
    const parameterDigest = promotionParameterDigest(input);
    const known = this.dependencies.ledger.snapshot().createIntents[intentId];
    if (known) {
      if (
        known.mode !== "seed" ||
        known.parameterDigest !== parameterDigest
      ) {
        return {
          section_id: known.sectionId,
          first_turn: "rejected",
          detail: "同一回合的 promote 参数与已入账 intent 冲突",
        };
      }
      const resumed = await this.resumeToolResult(intentId);
      return resumed.first_turn === "idle"
        ? { section_id: resumed.section_id, first_turn: "idle" }
        : {
            section_id: resumed.section_id,
            first_turn: "rejected",
            ...(resumed.detail ? { detail: resumed.detail } : {}),
          };
    }
    const source = await this.dependencies.chats.store.get(context.lease.chatId);
    if (!source) return { section_id: "", first_turn: "rejected" };
    try {
      const agent = (input.agent ?? source.agent) as AgentBackendId;
      backendById(agent);
      const projectId = input.inheritProject ? source.projectId : null;
      if (input.inheritProject && !projectId) {
        throw new Error(
          "inherit_project 只允许继承当前 Section 自己的 external-bound Project"
        );
      }
      const sectionId = stableId("section", intentId);
      const incarnationId = createHash("sha256")
        .update(`incarnation:${intentId}`)
        .digest("hex")
        .slice(0, 32);
      const admit = async (projectAdmissionHeld = false) => {
        if (projectId) {
          const liveSource = await this.dependencies.chats.store.get(source.id);
          if (
            liveSource?.incarnationId !== source.incarnationId ||
            liveSource.projectId !== projectId ||
            !this.dependencies.isExternalProject?.(projectId)
          ) {
            throw new Error(
              "inherit_project 只允许继承当前 Section 自己的 external-bound Project"
            );
          }
        }
        await this.dependencies.ledger.putCreateIntent({
          mode: "seed",
          parameterDigest,
          id: intentId,
          sectionId,
          incarnationId,
          source: sectionRef(source),
          rootChainId: rootChainId(context),
          messages: input.messages,
          promotedFrom: input.promotedFrom,
          ...(input.title ? { title: input.title } : {}),
          agent,
          ...(projectId ? { projectId } : {}),
          contextSections: [sectionRef(source)],
          createdAt: Date.now(),
          sagaPhase: "validated",
        });
        const result = await this.resumeToolResult(intentId, projectAdmissionHeld);
        return result.first_turn === "idle"
          ? { section_id: result.section_id, first_turn: "idle" as const }
          : {
              section_id: result.section_id,
              first_turn: "rejected" as const,
              ...(result.detail ? { detail: result.detail } : {}),
            };
      };
      if (!projectId) return await admit();
      if (!this.dependencies.withWorkspaceLifecycle) {
        throw new Error("Project lifecycle gate 不可用，拒绝继承 Project");
      }
      return await this.dependencies.withWorkspaceLifecycle(() => admit(true));
    } catch (cause) {
      return {
        section_id:
          this.dependencies.ledger.snapshot().createIntents[intentId]?.sectionId ?? "",
        first_turn: "rejected",
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  resume(intentId: string, projectAdmissionHeld = false) {
    return resumeCreateSectionSaga(
      intentId,
      {
        ledger: this.dependencies.ledger,
        chats: this.dependencies.chats,
        notices: this.dependencies.notices,
        isExternalProject: this.dependencies.isExternalProject,
        withWorkspaceLifecycle: this.dependencies.withWorkspaceLifecycle,
        kick: this.dependencies.kick,
      },
      projectAdmissionHeld
    );
  }

  private async resumeToolResult(
    intentId: string,
    projectAdmissionHeld = false
  ) {
    try {
      const result = await this.resume(intentId, projectAdmissionHeld);
      return {
        section_id: result.sectionId,
        first_turn: result.firstTurn,
      };
    } catch (cause) {
      const intent =
        this.dependencies.ledger.snapshot().createIntents[intentId];
      return {
        section_id: intent?.sectionId ?? "",
        first_turn: "rejected" as const,
        detail: `CreateIntent 已安全入账，可用同一调用重试或由启动恢复：${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      };
    }
  }
}

export function promotionParameterDigest(input: {
  agentThreadId: string;
  title?: string;
  agent?: string;
  inheritProject?: boolean;
  note?: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    agentThreadId: input.agentThreadId,
    title: input.title ?? null,
    agent: input.agent ?? null,
    inheritProject: input.inheritProject ?? false,
    note: input.note ?? null,
  })).digest("hex");
}
