/**
 * [INPUT]: Depends on consent-bound account state, original lifecycle identities and SQLite classification custody.
 * [OUTPUT]: Prepares and confirms Project rescue without early canonical or session changes and applies hash-fenced keep-original decisions.
 * [POS]: Cloud adapter for the existing Project rescue saga; the original outbox owns delivery and receipt recovery.
 */
import type { ChatCipherPort } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { canonicalJson, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema } from "@ai-chat/cloud-protocol/chats/classification";
import { projectChatClassification, syncScopeSchema, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { chatFactsSchema } from "../../../chats/chat-schema";
import { clearProjectRecord } from "../../../chats/store/transitions";
import { withFactRevision } from "../../../chats/chat-record-lifecycle";
import type { LifecycleIntent } from "../../../lifecycle/intent-types";
import type { LifecycleIntentStore } from "../../../lifecycle/intent-store";
import type { ProjectRescueCloud, ProjectRescueStep } from "../../../projects/rescue/service";
import type { CloudAccountService } from "../../runtime/service";
import type { AccountTransport } from "../../runtime/transport";
import type { SyncBindingStore } from "../account/binding";
import type { CleanupOwners } from "../account/cleanup/plan";
import { DesktopClassificationPublisher } from "../chats/classification/publisher";
type Ports = { config: CloudBuildConfig; deviceId: string; crypto(): ChatCipherPort; binding: SyncBindingStore; owners: Pick<CleanupOwners, "chats" | "projects">; journal: LifecycleIntentStore;
  account(): ReturnType<CloudAccountService["snapshot"]>; transport: Pick<AccountTransport, "query" | "mutate">;
  own(activity: { close(): Promise<void> }): () => unknown; changed(): void };
export class DesktopProjectRescue implements ProjectRescueCloud {
  constructor(private readonly ports: Ports) {}
  private current(scope: SyncScope) {
    const bound = this.ports.binding.snapshot(), account = this.ports.account();
    if (!bound || bound.phase !== "active" || bound.paused || bound.userId !== scope.userId || bound.deviceId !== this.ports.deviceId ||
      scope.environment !== this.ports.config.environmentId || account.status !== "ready" || account.profile?.userId !== scope.userId) throw new Error("PROJECT_RESCUE_ACCOUNT_NOT_READY");
  }
  private async candidate(scope: SyncScope, operationId: string) {
    const value = await this.ports.owners.chats.sync.read(scope, { type: "classification", lifecycleOperationId: operationId });
    if (value.type !== "classification") throw new Error("PROJECT_RESCUE_CANDIDATE_UNAVAILABLE");
    return value.value;
  }
  async prepare(intent: LifecycleIntent): Promise<ProjectRescueStep | null> {
    if (intent.kind !== "project-chat-rescue") throw new Error("PROJECT_RESCUE_INTENT_CHANGED");
    const bound = this.ports.binding.snapshot();
    if (!bound && !intent.recoveryState.cloudRescueScope) return null;
    const scope = syncScopeSchema.parse(intent.recoveryState.cloudRescueScope ?? { environment: this.ports.config.environmentId, userId: bound?.userId });
    this.current(scope);
    const operationId = hashChatContent([intent.kind, scope, intent.intentId]), chatId = String(intent.input.chatId);
    let candidate = await this.candidate(scope, operationId);
    if (!candidate) {
      const chat = this.ports.owners.chats.getMetadata(chatId);
      if (!chat || chat.incarnationId !== intent.input.incarnationId || chat.projectId !== intent.input.projectId || chat.readOnlyReason || chat.executionKind === "managed-worktree" ||
        this.ports.owners.projects.get(String(intent.input.projectId))) throw new Error("PROJECT_RESCUE_SOURCE_CHANGED");
      const { preview: _preview, ...facts } = chat;
      const next = withFactRevision(facts, { ...clearProjectRecord(facts), session: null });
      await this.ports.journal.advance(intent.intentId, intent.phase, { cloudRescueScope: scope });
      this.current(scope);
      await this.ports.owners.chats.sync.mutate(scope, hashChatContent([operationId, "propose"]), { type: "propose-classification", lifecycleOperationId: operationId,
        expectedRevision: facts.chatRecordRevision, previous: projectChatClassification(facts), facts: chatFactsSchema.parse(next),
        projectRescue: { projectId: String(intent.input.projectId) } });
      candidate = await this.candidate(scope, operationId);
    }
    if (!candidate?.operation_json) throw new Error("PROJECT_RESCUE_CANDIDATE_UNAVAILABLE");
    const operation = chatClassificationOperationSchema.parse(JSON.parse(candidate.operation_json));
    if (operation.chatId !== chatId || operation.incarnationId !== intent.input.incarnationId ||
      canonicalJson(operation.projectRescue) !== canonicalJson({ projectId: intent.input.projectId })) throw new Error("PROJECT_RESCUE_CANDIDATE_CHANGED");
    if (["conflicted", "discarded"].includes(candidate.state)) throw new Error("PROJECT_RESCUE_CONFLICT_REQUIRES_REVIEW");
    if (!candidate.receipt_json) return { deliver: () => this.deliver(scope, operationId) };
    if (chatClassificationReceiptSchema.parse(JSON.parse(candidate.receipt_json)).status !== "applied") throw new Error("PROJECT_RESCUE_CONFLICT_REQUIRES_REVIEW");
    return { commit: async () => {
      this.current(scope);
      await this.ports.owners.chats.sync.mutate(scope, hashChatContent(["classification-commit", operationId]), { type: "commit-classification", lifecycleOperationId: operationId });
      this.current(scope); this.ports.changed();
    } };
  }
  private async deliver(scope: SyncScope, operationId: string) {
    this.current(scope); let cancelled = false, flight: Promise<void> = Promise.resolve();
    const release = this.ports.own({ close: async () => { cancelled = true; await flight.catch(() => {}); } });
    const current = () => { if (cancelled) throw new Error("PROJECT_RESCUE_DELIVERY_CLOSED"); this.current(scope); };
    try {
      flight = (async () => {
        const outbox = await this.ports.owners.chats.sync.read(scope, { type: "outbox", afterId: null, limit: 1, id: operationId }); current();
        if (outbox.type !== "outbox" || outbox.value.length !== 1 || outbox.value[0]!.id !== operationId) throw new Error("PROJECT_RESCUE_OUTBOX_UNAVAILABLE");
        await new DesktopClassificationPublisher({ ...this.ports, scope, store: this.ports.owners.chats.sync, current }).confirmRescue(outbox.value);
      })();
      await flight;
    } finally { release(); }
  }
  async discard(intent: LifecycleIntent, candidateHash: string, recordDecision: () => Promise<void>) {
    const scope = syncScopeSchema.parse(intent.recoveryState.cloudRescueScope);
    this.current(scope);
    const operationId = hashChatContent([intent.kind, scope, intent.intentId]), candidate = await this.candidate(scope, operationId);
    if (!candidate?.receipt_json || candidate.candidate_hash !== candidateHash || !["conflicted", "discarded"].includes(candidate.state) ||
      chatClassificationReceiptSchema.parse(JSON.parse(candidate.receipt_json)).status === "applied") throw new Error("PROJECT_RESCUE_REVIEW_CHANGED");
    await recordDecision(); this.current(scope);
    await this.ports.owners.chats.sync.mutate(scope, hashChatContent([operationId, "discard", candidateHash]), {
      type: "discard-classification", lifecycleOperationId: operationId, candidateHash });
    this.ports.changed();
  }
}
