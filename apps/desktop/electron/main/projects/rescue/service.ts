/**
 * [INPUT]: Depends on the existing Chat/Project stores, lifecycle journal and Project/conversation admission gates.
 * [OUTPUT]: Rescues missing-Project Chats through local release or original cloud classification confirmation and recoverable explicit discard.
 * [POS]: Project lifecycle saga; canonical classification and session change together before transient session ownership is released.
 */
import { randomUUID } from "node:crypto";
import type { ChatStore } from "../../chats/chat-store";
import type { ChatMetadata } from "../../chats/chat-summary";
import type { ProjectStore } from "../store/project-store";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import type { LifecycleIntent } from "../../lifecycle/intent-types";
import type { AdmissionGate, SagaResult } from "../../lifecycle/admission-gate";
import { preservedConversion, type ConversionScopeCleanup } from "../../lifecycle/scope-cleanup/conversion";

export type ProjectRescueStep = { deliver(): Promise<void> } | { commit(): Promise<void> };
export interface ProjectRescueCloud {
  prepare(intent: LifecycleIntent): Promise<ProjectRescueStep | null>;
  discard(intent: LifecycleIntent, candidateHash: string, recordDecision: () => Promise<void>): Promise<void>;
}
type Ports = {
  chats: ChatStore; projects: ProjectStore; journal: LifecycleIntentStore; gate: AdmissionGate;
  projectExclusive<T>(work: () => Promise<T>): Promise<T>;
  conversationExclusive<T>(chatId: string, work: () => Promise<T>): Promise<T>;
  active(chatId: string): boolean;
  cloudEnabled?: boolean;
  releaseLocal(chatId: string): Promise<unknown>;
  releaseSession(chatId: string): void;
  changed(chat: ChatMetadata): void;
};
const kept = (): SagaResult => ({ status: "business-rejected", error: { code: "PROJECT_RESCUE_DISCARDED", message: "The original Chat was kept." } });
export class ProjectRescueService {
  private cloud: ProjectRescueCloud | null = null;
  private readonly flights = new Map<string, Promise<number>>();
  constructor(private readonly ports: Ports) {}
  attachCloud(cloud: ProjectRescueCloud) {
    if (this.cloud) throw new Error("PROJECT_RESCUE_CLOUD_ALREADY_ATTACHED");
    this.cloud = cloud;
  }
  settleScopeCleanup(intentId: string, cleanup: ConversionScopeCleanup) {
    return this.ports.gate.runRecovery(intentId, intent => this.ports.projectExclusive(() =>
      this.ports.conversationExclusive(String(intent.input.chatId), async (): Promise<SagaResult> => {
        if (intent.kind !== "project-chat-rescue") throw new Error("CONVERSION_CLEANUP_INTENT_CHANGED");
        const decision = await cleanup.prepare(intent), chatId = String(intent.input.chatId);
        if (this.ports.active(chatId)) throw new Error("CONVERSION_CLEANUP_ACTIVE_TURN");
        if (decision.disposition === "complete") {
          await cleanup.commit(intent);
          const chat = this.ports.chats.getMetadata(chatId);
          if (!chat || chat.incarnationId !== intent.input.incarnationId || chat.projectId || chat.session || chat.context.kind !== "ordinary") throw new Error("CONVERSION_CLEANUP_CHAT_CHANGED");
          this.ports.releaseSession(chatId); this.ports.changed(chat);
        }
        return decision.disposition === "complete" ? { status: "done", receipt: decision.receipt } : preservedConversion();
      })));
  }
  release(projectId: string) {
    const running = this.flights.get(projectId);
    if (running) return running;
    const flight = this.releaseProject(projectId).finally(() => { this.flights.delete(projectId); });
    this.flights.set(projectId, flight);
    return flight;
  }
  private async releaseProject(projectId: string) {
    const { projects, chats, journal, gate } = this.ports;
    const records = await this.ports.projectExclusive(async () => {
      if (projects.get(projectId)) throw new Error("PROJECT_RESCUE_PROJECT_EXISTS");
      const records = chats.listByProject(projectId).map(chatId => chats.getMetadata(chatId)!);
      if (records.some(chat => chat.readOnlyReason || chat.executionKind === "managed-worktree")) throw new Error("PROJECT_RESCUE_SOURCE_UNAVAILABLE");
      return records;
    });
    const pending = (await journal.listPending()).filter(intent => intent.kind === "project-chat-rescue" && intent.input.projectId === projectId);
    const inputs = new Map(pending.map(intent => [String(intent.input.chatId), { input: intent.input, requestId: intent.requestId }]));
    for (const chat of records) if (!inputs.has(chat.id)) inputs.set(chat.id, { input: { chatId: chat.id, incarnationId: chat.incarnationId, projectId }, requestId: randomUUID() });
    const errors: unknown[] = [];
    for (const request of inputs.values()) {
      try {
        const outcome = await gate.admitAndRun({ kind: "project-chat-rescue", ...request }, intent => this.recover(intent));
        if (outcome.state === "settled" ? outcome.status !== "done" : outcome.result.status !== "done") throw new Error("PROJECT_RESCUE_PENDING");
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Some Chats still need Project rescue confirmation.");
    return inputs.size;
  }
  async recoverPending() {
    const errors: unknown[] = [];
    for (const intent of await this.ports.journal.listPending()) {
      if (intent.kind !== "project-chat-rescue") continue;
      try { await this.ports.gate.runRecovery(intent.intentId, next => this.recover(next)); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Some Project rescues still require recovery.");
  }
  async keepOriginal(intentId: string, candidateHash: string) {
    await this.ports.gate.runRecovery(intentId, async intent => {
      if (intent.kind !== "project-chat-rescue" || !this.cloud || !intent.recoveryState.cloudRescueScope) throw new Error("PROJECT_RESCUE_REVIEW_CHANGED");
      await this.cloud.discard(intent, candidateHash, async () => {
        await this.ports.journal.advance(intent.intentId, intent.phase, { cloudKeepOriginal: candidateHash });
      });
      return kept();
    });
  }
  async recover(original: LifecycleIntent): Promise<SagaResult> {
    if (original.recoveryState.scopeCleanup) throw new Error("CONVERSION_SCOPE_CLEANUP_REQUIRED");
    if (original.kind !== "project-chat-rescue") throw new Error("PROJECT_RESCUE_INTENT_CHANGED");
    let intent = original;
    const { chats, projects, journal } = this.ports;
    const chatId = String(intent.input.chatId), projectId = String(intent.input.projectId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const step = await this.ports.projectExclusive(() => this.ports.conversationExclusive(chatId, async (): Promise<SagaResult | ProjectRescueStep> => {
        const chat = chats.getMetadata(chatId);
        if (!chat || chat.incarnationId !== intent.input.incarnationId) throw new Error("PROJECT_RESCUE_CHAT_CHANGED");
        if (chat.readOnlyReason || chat.executionKind === "managed-worktree") throw new Error("PROJECT_RESCUE_SOURCE_UNAVAILABLE");
        if (intent.recoveryState.cloudKeepOriginal) {
          if (!this.cloud) throw new Error("PROJECT_RESCUE_CLOUD_PENDING");
          await this.cloud.discard(intent, String(intent.recoveryState.cloudKeepOriginal), async () => {});
          return kept();
        }
        if (this.ports.active(chatId)) throw new Error("PROJECT_RESCUE_ACTIVE_TURN");
        if (!this.cloud && this.ports.cloudEnabled) throw new Error("PROJECT_RESCUE_CLOUD_PENDING");
        const localTarget = !intent.recoveryState.cloudRescueScope && chat.projectId === null && chat.context.kind === "ordinary" && chat.session === null;
        if (!intent.recoveryState.cloudRescueScope && intent.phase !== "classification-committed") {
          if (projects.get(projectId) || chat.projectId !== projectId && !localTarget) throw new Error("PROJECT_RESCUE_SOURCE_CHANGED");
        }
        if (!this.cloud && intent.recoveryState.cloudRescueScope) throw new Error("PROJECT_RESCUE_CLOUD_PENDING");
        if (intent.phase !== "classification-committed") {
          const cloud = localTarget ? null : await this.cloud?.prepare(intent);
          if (cloud && "deliver" in cloud) return cloud;
          if (cloud) await cloud.commit();
          else if (!localTarget) await this.ports.releaseLocal(chatId);
          intent = await journal.advance(intent.intentId, "classification-committed");
        }
        this.ports.releaseSession(chatId);
        const updated = chats.getMetadata(chatId);
        if (!updated || updated.projectId !== null || updated.context.kind !== "ordinary" || updated.session !== null) throw new Error("PROJECT_RESCUE_COMMIT_PENDING");
        this.ports.changed(updated);
        return { status: "done", receipt: { chatId, projectId, incarnationId: updated.incarnationId } };
      }));
      if ("status" in step) return step;
      if (!("deliver" in step) || attempt > 0) throw new Error("PROJECT_RESCUE_CONFIRMATION_PENDING");
      await step.deliver();
      const next = await journal.getById(intent.intentId);
      if (!next || next.terminal) throw new Error("PROJECT_RESCUE_INTENT_CHANGED");
      intent = next;
    }
    throw new Error("PROJECT_RESCUE_CONFIRMATION_PENDING");
  }
}
