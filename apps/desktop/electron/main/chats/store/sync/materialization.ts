/**
 * [INPUT]: Depends on real Home markers, Project workspace authority, lifecycle checkpoints and the Chat synchronization facade
 * [OUTPUT]: Materializes ordinary mirrors and source-owned readonly imports with fixed identity and original Home custody.
 * [POS]: Cross-owner preparation driver above Store queues; App mirrors remain non-executable
 */
import type { ChatHomeService } from "../../../chat-home/chat-home-service";
import type { ChatStore } from "../../chat-store";
import type { ProjectStore } from "../../../projects/store/project-store";
import { chatRecordSchema } from "../../chat-schema";
import { portableChatSchema, syncScopeSchema, type PortableChat, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ChatMessage } from "../../../../../shared/chats-ipc";
import { LifecycleIntentStore } from "../../../lifecycle/intent-store";
import { AdmissionGate } from "../../../lifecycle/admission-gate";
import { reached, type LifecycleIntent } from "../../../lifecycle/intent-types";
import { cloudRequestHash } from "./api";
export class ChatMirrorMaterializer {
  constructor(private chats: ChatStore, private homes: ChatHomeService, private journal: LifecycleIntentStore, private gate: AdmissionGate, private projects?: ProjectStore) {}
  async run(operationId: string, scope: SyncScope, input: PortableChat) {
    const chat = portableChatSchema.parse(input);
    if (chat.classification.conversationKind !== "ordinary") throw new Error("APP_INSTALLATION_PREPARATION_REQUIRED");
    this.projectBinding(chat);
    const prior = await this.journal.readByRequest("chat-materialize", operationId);
    const request = prior?.result.state === "pending" ? prior.result.intent.input : { scope: syncScopeSchema.parse(scope), chat };
    return this.gate.admitAndRun({ kind: "chat-materialize", requestId: operationId, input: request }, intent => this.resume(intent));
  }
  private projectBinding(chat: PortableChat) {
    if (!chat.classification.projectId) return null;
    const project = this.projects?.get(chat.classification.projectId);
    if (!project || project.workspaceBinding.kind !== "external" || project.deletionCheckpoint || project.archivedAt) throw new Error("PROJECT_WORKSPACE_PREPARATION_REQUIRED");
    return { projectId: project.id, capabilityId: project.workspaceBinding.capabilityId, lifecycleRevision: project.projectLifecycleRevision };
  }
  async recover() {
    for (const intent of await this.journal.listPending()) if (intent.kind === "chat-materialize") await this.gate.runRecovery(intent.intentId, current => this.resume(current));
  }
  private async resume(initial: LifecycleIntent) {
    const frozen = portableChatSchema.parse(initial.input.chat), scope = syncScopeSchema.parse(initial.input.scope);
    const mirror = await this.chats.sync.read(scope, { type: "mirror", chatId: frozen.id, afterSeq: 0, limit: 1 });
    const chat = mirror.type === "mirror" && mirror.value ? mirror.value.chat : frozen;
    if (chat.id !== frozen.id || chat.incarnationId !== frozen.incarnationId || cloudRequestHash(chat.classification) !== cloudRequestHash(frozen.classification)) throw new Error("MATERIALIZATION_IDENTITY_CONFLICT");
    if (chat.classification.conversationKind !== "ordinary") throw new Error("APP_INSTALLATION_PREPARATION_REQUIRED");
    let intent = initial;
    const binding = this.projectBinding(chat);
    if (binding) {
      if (intent.recoveryState.project && cloudRequestHash(intent.recoveryState.project) !== cloudRequestHash(binding)) throw new Error("PROJECT_WORKSPACE_CHANGED_DURING_PREPARATION");
      if (!intent.recoveryState.project) intent = await this.journal.advance(intent.intentId, intent.phase, { project: binding });
    }
    const op = (step: string) => cloudRequestHash({ intentId: intent.intentId, step });
    if (!reached("chat-materialize", intent, "home-committed")) {
      const previous = this.homes.ledger.get(chat.id);
      if (previous && (previous.incarnationId !== chat.incarnationId || previous.ownership !== "valid")) throw new Error("HOME_IDENTITY_CHANGED");
      if (!previous) await this.homes.beginCreation({ intentId: intent.intentId, chatId: chat.id, incarnationId: chat.incarnationId,
        workspaceScope: { kind: "conversation", conversationId: chat.id }, submission: { chat: frozen, scope } });
      const home = this.homes.ledger.get(chat.id)!;
      if (home.phase !== "committed" && home.intentId !== intent.intentId) throw new Error("HOME_PREPARATION_IN_PROGRESS");
      if (home.phase !== "committed") { await this.homes.markPrepared(chat.id); await this.homes.commitCreation(chat.id); }
      const evidence = await this.homes.committedCreationEvidence(chat.id, home.intentId);
      intent = await this.journal.advance(intent.intentId, "home-committed", { home: evidence });
    }
    const homeIntentId = this.homes.ledger.get(chat.id)?.intentId;
    if (!homeIntentId) throw new Error("HOME_OWNERSHIP_UNAVAILABLE");
    const evidence = await this.homes.committedCreationEvidence(chat.id, homeIntentId);
    if (cloudRequestHash(evidence) !== cloudRequestHash(intent.recoveryState.home)) throw new Error("HOME_IDENTITY_CHANGED");
    if (!reached("chat-materialize", intent, "chat-committed")) {
      const existing = this.chats.getMetadata(chat.id)?.readOnlyReason === "external-readonly" ? null : await this.chats.get(chat.id);
      if (!existing) {
        await this.chats.sync.mutate(scope, op("home"), { type: "prepare-materialization", chatId: chat.id, expectedCloudRevision: chat.cloudRevision,
          evidence: { ...evidence.receipt, projectId: chat.classification.projectId } });
        const head = await this.chats.sync.read(scope, { type: "mirror", chatId: chat.id, afterSeq: 0, limit: 1 });
        if (head.type !== "mirror" || !head.value) throw new Error("MIRROR_UNAVAILABLE");
        const subagents = head.value.subagents;
        const messages: ChatMessage[] = [];
        let afterSeq = 0;
        while (true) {
          const result = await this.chats.sync.read(scope, { type: "mirror", chatId: chat.id, afterSeq, limit: 100 });
          if (result.type !== "mirror" || !result.value?.bodyReady) throw new Error("MIRROR_UNAVAILABLE"); const page = result.value;
          messages.push(...page.messages);
          if (messages.length > 2000) throw new Error("MIRROR_MATERIALIZATION_BUDGET");
          if (page.complete) break;
          if (!page.cursor || page.cursor <= afterSeq) throw new Error("MIRROR_CURSOR_INVALID"); afterSeq = page.cursor;
        }
        const start = await this.chats.sync.read(scope, { type: "canonical-start", chatId: chat.id });
        if (start.type !== "canonical-start") throw new Error("MIRROR_START_UNAVAILABLE");
        const { classification: _classification, cloudRevision: _cloudRevision, ...portable } = chat;
        const record = chatRecordSchema.parse({ ...portable,
          homeDir: evidence.receipt.homeDir, grants: [], grantRevision: 0, context: { kind: "ordinary" },
          projectId: chat.classification.projectId, appRole: null, session: null, importOrigin: null, snapshotDigest: null, forkAgent: null,
          titleSource: chat.title ? "user" : "local-fallback", titleJob: { state: "none" },
          startState: start.value,
          chatRecordRevision: 1, chatMessageRevision: 1, nextSeq: head.value.nextSeq, trimmedThroughSeq: head.value.trimmedThroughSeq, messages, subagents });
        await this.chats.sync.mutate(scope, op("record"), { type: "materialize", expectedCloudRevision: chat.cloudRevision, record });
      } else if (existing.incarnationId !== chat.incarnationId || existing.homeDir !== evidence.receipt.homeDir) throw new Error("MATERIALIZATION_IDENTITY_CONFLICT");
      intent = await this.journal.advance(intent.intentId, "chat-committed");
    }
    return { status: "done" as const, receipt: { chatId: chat.id, incarnationId: chat.incarnationId, home: evidence } };
  }
}
