/**
 * [INPUT]: Depends on real Home markers, Project workspace authority, lifecycle checkpoints and the Chat synchronization facade
 * [OUTPUT]: Materializes an ordinary mirror with fixed identities, persisted sequence watermarks and recoverable Home checkpoints
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
  run(operationId: string, scope: SyncScope, input: PortableChat) {
    const chat = portableChatSchema.parse(input);
    if (chat.classification.conversationKind !== "ordinary") throw new Error("APP_INSTALLATION_PREPARATION_REQUIRED");
    this.projectBinding(chat);
    return this.gate.admitAndRun({ kind: "chat-materialize", requestId: operationId, input: { scope: syncScopeSchema.parse(scope), chat } }, intent => this.resume(intent));
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
    const chat = portableChatSchema.parse(initial.input.chat), scope = syncScopeSchema.parse(initial.input.scope);
    if (chat.classification.conversationKind !== "ordinary") throw new Error("APP_INSTALLATION_PREPARATION_REQUIRED");
    let intent = initial;
    const binding = this.projectBinding(chat);
    if (binding) {
      if (intent.recoveryState.project && cloudRequestHash(intent.recoveryState.project) !== cloudRequestHash(binding)) throw new Error("PROJECT_WORKSPACE_CHANGED_DURING_PREPARATION");
      if (!intent.recoveryState.project) intent = await this.journal.advance(intent.intentId, intent.phase, { project: binding });
    }
    const op = (step: string) => cloudRequestHash({ intentId: intent.intentId, step });
    if (!reached("chat-materialize", intent, "home-committed")) {
      await this.homes.beginCreation({ intentId: intent.intentId, chatId: chat.id, incarnationId: chat.incarnationId,
        workspaceScope: { kind: "conversation", conversationId: chat.id }, submission: { chat, scope } });
      const home = this.homes.ledger.get(chat.id)!;
      if (home.phase !== "committed") { await this.homes.markPrepared(chat.id); await this.homes.commitCreation(chat.id); }
      const evidence = await this.homes.committedCreationEvidence(chat.id, intent.intentId);
      intent = await this.journal.advance(intent.intentId, "home-committed", { home: evidence });
    }
    const evidence = await this.homes.committedCreationEvidence(chat.id, intent.intentId);
    if (!reached("chat-materialize", intent, "chat-committed")) {
      const existing = await this.chats.get(chat.id);
      if (!existing) {
        await this.chats.sync.mutate(scope, op("home"), { type: "prepare-materialization", chatId: chat.id, expectedCloudRevision: chat.cloudRevision,
          evidence: { ...evidence.receipt, projectId: chat.classification.projectId } });
        const head = await this.chats.sync.read(scope, { type: "mirror", chatId: chat.id, afterSeq: 0, limit: 1 });
        if (head.type !== "mirror" || !head.value) throw new Error("MIRROR_UNAVAILABLE");
        const subagents = head.value.subagents;
        const messages: ChatMessage[] = [];
        let afterSeq = 0;
        while (true) {
          const page = (await this.chats.sync.read(scope, { type: "mirror", chatId: chat.id, afterSeq, limit: 100 })).value as { messages: ChatMessage[] } | null;
          if (!page) throw new Error("MIRROR_UNAVAILABLE");
          messages.push(...page.messages);
          if (messages.length > 2000) throw new Error("MIRROR_MATERIALIZATION_BUDGET");
          if (page.messages.length < 100) break;
          afterSeq = page.messages.at(-1)!.seq;
        }
        const firstUser = messages.find(message => message.role === "user");
        const { classification: _classification, cloudRevision: _cloudRevision, ...portable } = chat;
        const record = chatRecordSchema.parse({ ...portable,
          homeDir: evidence.receipt.homeDir, grants: [], grantRevision: 0, context: { kind: "ordinary" },
          projectId: chat.classification.projectId, appRole: null, session: null, importOrigin: null, snapshotDigest: null, forkAgent: null,
          titleSource: chat.title ? "user" : "local-fallback", titleJob: { state: "none" },
          startState: firstUser ? { kind: "started-exact", firstUserMessageAt: firstUser.createdAt, firstUserMessageSeq: firstUser.seq } : { kind: "unstarted" },
          chatRecordRevision: 1, chatMessageRevision: 1, nextSeq: head.value.nextSeq, messages, subagents });
        await this.chats.sync.mutate(scope, op("record"), { type: "materialize", expectedCloudRevision: chat.cloudRevision, record });
      } else if (existing.incarnationId !== chat.incarnationId || existing.homeDir !== evidence.receipt.homeDir) throw new Error("MATERIALIZATION_IDENTITY_CONFLICT");
      intent = await this.journal.advance(intent.intentId, "chat-committed");
    }
    return { status: "done" as const, receipt: { chatId: chat.id, incarnationId: chat.incarnationId, home: evidence } };
  }
}
