/**
 * [INPUT]: Depends on confirmed execution identity, the existing Home/lifecycle/Store owners and private file transport.
 * [OUTPUT]: Prepares explicitly claimed native/imported Chats and acknowledges ready after canonical content and local files are verified.
 * [POS]: Shared local continuation driver; it never chooses an executor, starts an Agent or requires the prior backend to be installed.
 */
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { openChatHeadForRequest } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatStore } from "../../chats/chat-store";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import type { AttachmentStore } from "../../chats/attachment-store";
import type { ProjectStore } from "../../projects/store/project-store";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import type { AdmissionGate } from "../../lifecycle/admission-gate";
import { ChatMirrorMaterializer } from "../../chats/store/sync/materialization";
import type { AccountTransport } from "../runtime/transport";
import type { DesktopBlobStore } from "../files/store";
import { DesktopChatDownlink } from "../sync/downlink/chats";
import { HomeSnapshotRestorer } from "../sync-home/restore/restorer";
import { restoreExecutionAttachments } from "./attachments";
import { DesktopChatConvergence } from "../sync/convergence/service";
import type { RecoverySave } from "../chat/recovery/save";
export type PreparationPhase = "settling" | "body" | "home" | "attachments" | "ready";
export type ProjectPreparationGate = { runExclusive<T>(task: () => Promise<T>): Promise<T>; isUsable(projectId: string): boolean };
type Ports = { userData: string; crypto(): FileCipherPort; config: CloudBuildConfig; scope: SyncScope; deviceId: string; chats: ChatStore; homes: ChatHomeService; projects: ProjectStore;
  attachments: AttachmentStore; journal: LifecycleIntentStore; gate: AdmissionGate; projectGate: ProjectPreparationGate;
  files: DesktopBlobStore; transport: Pick<AccountTransport, "query" | "mutate">; signal: AbortSignal; recovery?: Pick<RecoverySave, "save">;
  current(): void; assertIdle(chatId: string): void; progress(phase: PreparationPhase): void; changed(): void };
export class CloudChatMaterializer {
  private readonly header;
  constructor(private input: Ports) { const crypto = input.crypto(); this.header = { ...protocolHeader(input.config), expectedUserId: input.scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }; }
  private active() { this.input.signal.throwIfAborted(); this.input.current(); }
  private sameExecutor(expected: CloudChatHead, current: CloudChatHead) {
    if (current.chat.id !== expected.chat.id || current.chat.incarnationId !== expected.chat.incarnationId || current.executorDeviceId !== this.input.deviceId ||
      current.executionEpoch !== expected.executionEpoch || current.archivedAt !== null || current.chat.classification.conversationKind !== "ordinary" || current.kind === "external-readonly") throw new Error("EXECUTION_IDENTITY_CHANGED");
  }
  private async accept(head: CloudChatHead) {
    this.active(); await this.input.chats.sync.mutate(this.input.scope, hashChatContent(["execution-head", this.input.scope, head]), { type: "put-mirror-head", head });
    this.active(); this.input.changed();
  }
  private async fresh(expected: CloudChatHead) {
    this.active(); const wire = await this.input.transport.query("chats/metadata:head", { ...this.header, chatId: expected.chat.id }); this.active();
    if (!wire || wire.remoteCreation) throw new Error("EXECUTION_IDENTITY_CHANGED"); const head = await openChatHeadForRequest(wire, expected.chat.id, this.input.crypto(), this.input.signal); this.active(); this.sameExecutor(expected, head); await this.accept(head); return head;
  }
  private async current(expected: CloudChatHead) {
    this.active(); this.input.assertIdle(expected.chat.id);
    const result = await this.input.chats.sync.read(this.input.scope, { type: "local-execution", chatId: expected.chat.id }); this.active();
    if (result.type !== "local-execution" || !result.value || result.value.deleted) throw new Error("EXECUTION_IDENTITY_CHANGED");
    const head = result.value.head; this.sameExecutor(expected, head);
    if (head.bodyRevision !== expected.bodyRevision || head.homeSnapshotId !== expected.homeSnapshotId || head.openTurnId ||
      head.chat.cloudRevision !== expected.chat.cloudRevision) throw new Error("EXECUTION_CONTENT_CHANGED");
  }
  private project(head: CloudChatHead) {
    const id = head.chat.classification.projectId; if (!id) return null;
    const project = this.input.projects.get(id);
    if (!project || project.archivedAt || project.deletionCheckpoint || project.workspaceBinding.kind !== "external" || !this.input.projectGate.isUsable(id)) throw new Error("PROJECT_WORKSPACE_PREPARATION_REQUIRED");
    return { projectId: id, lifecycleRevision: project.projectLifecycleRevision, binding: project.workspaceBinding,
      directory: this.input.projects.resolveWorkspace(project.workspaceBinding) };
  }
  async ensureExecutionReady(initial: CloudChatHead) {
    const { signal, chats, scope, homes, files } = this.input;
    let head = await this.fresh(initial);
    this.input.progress("settling"); const deadline = Date.now() + 30_000;
    while (head.openTurnId) {
      if (Date.now() >= deadline) throw new Error("EXECUTION_SETTLEMENT_PENDING");
      await delay(500, undefined, { signal }); head = await this.fresh(head);
    }
    this.input.assertIdle(head.chat.id);
    const project = await this.input.projectGate.runExclusive(async () => this.project(head));
    const checkProject = () => { if (canonicalJson(this.project(head)) !== canonicalJson(project)) throw new Error("PROJECT_WORKSPACE_CHANGED_DURING_PREPARATION"); };
    this.input.progress("body");
    const convergence = this.input.recovery ? new DesktopChatConvergence({ ...this.input, recovery: this.input.recovery, current: () => this.active() }) : null;
    const downlink = new DesktopChatDownlink({ ...this.input, store: chats.sync, files: files.transfer, cache: files, current: () => this.active(), changed: this.input.changed,
      beforeReceipts: value => convergence?.reconcile(value, undefined, true) ?? Promise.resolve() });
    const stop = () => { void downlink.close(); }; signal.addEventListener("abort", stop, { once: true });
    try { if (!await downlink.hydrate(head)) throw new Error("MIRROR_BODY_UNAVAILABLE"); }
    finally { signal.removeEventListener("abort", stop); await downlink.close(); }
    await this.current(head);
    await this.input.projectGate.runExclusive(async () => {
      checkProject(); this.input.assertIdle(head.chat.id); await this.current(head);
      if (!chats.getMetadata(head.chat.id) || chats.getMetadata(head.chat.id)?.readOnlyReason === "external-readonly") {
        const materializer = new ChatMirrorMaterializer(chats, homes, this.input.journal, this.input.gate, this.input.projects);
        await materializer.run(hashChatContent(["cloud-chat-home", scope, head.chat.id, head.chat.incarnationId, head.chat.classification.projectId]), scope, head.chat);
      }
      const home = homes.ledger.get(head.chat.id); if (!home) throw new Error("HOME_OWNERSHIP_UNAVAILABLE");
      const evidence = await homes.committedCreationEvidence(head.chat.id, home.intentId);
      const target = await chats.sync.read(scope, { type: "turn-target", chatId: head.chat.id });
      if (target.type !== "turn-target" || !target.value) throw new Error("EXECUTION_CONTENT_CHANGED");
      const action = { type: "install-execution-prefix" as const, chatId: head.chat.id, incarnationId: head.chat.incarnationId,
        requireConverged: Boolean(this.input.recovery),
        executionEpoch: head.executionEpoch, bodyRevision: head.bodyRevision, cloudRevision: head.chat.cloudRevision,
        expectedMessageRevision: target.value.messageRevision, expectedOutboxDigest: target.value.outboxDigest, home: evidence.receipt };
      await this.current(head); checkProject();
      await chats.sync.mutate(scope, hashChatContent(["execution-prefix", scope, action]), action);
    });
    this.input.changed(); this.input.progress("home");
    const restorer = new HomeSnapshotRestorer({ ...this.input, userId: scope.userId, current: value => this.current(value) });
    let home;
    try { home = await restorer.restore(head, signal); } finally { await restorer.close(); }
    this.input.progress("attachments");
    await restoreExecutionAttachments({ ...this.input, chatId: head.chat.id, current: () => this.current(head) });
    const latest = await this.fresh(head);
    if (latest.bodyRevision !== head.bodyRevision || latest.homeSnapshotId !== head.homeSnapshotId || latest.chat.cloudRevision !== head.chat.cloudRevision) throw new Error("EXECUTION_CONTENT_CHANGED");
    await this.input.projectGate.runExclusive(async () => { checkProject(); await this.current(head); });
    this.active();
    const readyWire = await this.input.transport.mutate("turns/executor:prepare", { ...this.header, chatId: head.chat.id, incarnationId: head.chat.incarnationId,
      executionEpoch: head.executionEpoch, bodyRevision: head.bodyRevision, homeSnapshotId: head.homeSnapshotId, state: "ready", reason: null });
    const ready = await openChatHeadForRequest(readyWire, head.chat.id, this.input.crypto(), signal); this.active();
    await this.input.projectGate.runExclusive(async () => { this.active(); checkProject(); this.sameExecutor(head, ready); await this.accept(ready); });
    this.input.progress("ready"); return { head: ready, home };
  }
}
