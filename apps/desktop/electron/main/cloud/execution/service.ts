/**
 * [INPUT]: Depends on explicit first-sync consent, current account identity and existing local execution/Home owners.
 * [OUTPUT]: Owns preparation, exact frozen-initial custody for remotely created Chats and bounded sanitized execution views.
 * [POS]: Main-only preparation service for Chats this computer owns; lost responses reconcile authority before any retry.
 */
import { protocolHeader, type BlobTransferPorts, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { openChatHeadForRequest, prepareRemoteChatInitialization } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { frozenRemoteChatInitializationSchema, type EncryptedChatHead } from "@ai-chat/cloud-protocol/chats/encrypted";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ExecutionView, ExecutionReason } from "@ai-chat/chat-ui/contracts";
import type { CloudAccountService } from "../runtime/service";
import type { AccountTransport } from "../runtime/transport";
import type { SyncBindingStore } from "../sync/account/binding";
import type { CleanupOwners } from "../sync/account/cleanup/plan";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import type { AdmissionGate } from "../../lifecycle/admission-gate";
import type { AttachmentStore } from "../../chats/attachment-store";
import type { TurnRuntimePorts } from "../remote/recorder";
import { ledgerActivityReason } from "../../sections/coordinator/agent-switch/activity";
import type { RecoverySave } from "../chat/recovery/save";
import { DesktopBlobStore } from "../files/store";
import { CloudChatMaterializer, type ProjectPreparationGate } from "./cloud-chat-materializer";
import { ExecutionDraftStore } from "./drafts";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
// One readiness predicate for the whole service, mirroring the SQLite fence (chats/sqlite/cloud/execution/state.ts):
// a preparation belonging to another device is not this device's readiness.
const preparationReady = (head: CloudChatHead, deviceId: string) => head.executionPreparation === null ||
  head.executionPreparation.deviceId === deviceId && head.executionPreparation.state === "ready";
type Progress = Pick<ExecutionView, "phase" | "reason" | "homeOmitted">;
type Flight = { userId: string; promise: Promise<void>; abort: AbortController };
type Ports = { config: CloudBuildConfig; userData: string; deviceId: string; owners: Pick<CleanupOwners, "chats" | "homes" | "projects">; journal: LifecycleIntentStore; gate: AdmissionGate;
  attachments: AttachmentStore; projectGate: ProjectPreparationGate; runtime: { ledger: TurnRuntimePorts["ledger"]; turns: Pick<TurnRuntimePorts["turns"], "liveEntries"> }; binding: Pick<SyncBindingStore, "snapshot">;
  account: Pick<CloudAccountService, "snapshot" | "subscribe">; transport: Pick<AccountTransport, "query" | "mutate">;
  filePorts(userId: string): BlobTransferPorts; own(activity: { close(): Promise<void> }): () => void; changed(): void;
  recovery?: Pick<RecoverySave, "save">; bindProject?(projectId: string, scope: SyncScope, current: () => Promise<void>): Promise<boolean> };
export class CloudExecutionService {
  private readonly flights = new Map<string, Flight>();
  private readonly progress = new Map<string, Progress>();
  private closed = false;
  private identity = "";
  private recovering: Promise<void> | null = null;
  private readonly unsubscribe: () => void;
  private readonly drafts: ExecutionDraftStore;
  constructor(private readonly input: Ports) {
    this.drafts = new ExecutionDraftStore(input.userData, input.config);
    this.unsubscribe = input.account.subscribe(() => this.accountChanged());
  }
  private scope(online = false) {
    const account = this.input.account.snapshot(), binding = this.input.binding.snapshot();
    if (this.closed || !binding || binding.phase === "closing" || account.profile?.userId !== binding.userId || account.deviceId !== this.input.deviceId || binding.deviceId !== this.input.deviceId ||
      !["ready", "temporarily-offline"].includes(account.status)) throw new Error("EXECUTION_ACCOUNT_UNAVAILABLE");
    if (online && (account.status !== "ready" || binding.paused)) throw new Error(binding.paused ? "EXECUTION_PAUSED" : "EXECUTION_OFFLINE");
    return { environment: this.input.config.environmentId, userId: binding.userId, manifestId: binding.manifestId };
  }
  private assertIdle(chatId: string) {
    if (this.input.runtime.turns.liveEntries().some(entry => entry.conversationId === chatId && (!entry.effectiveTerminal || entry.cleanup !== "complete" || !["stored", "empty", "missing"].includes(entry.persist))) ||
      ledgerActivityReason(this.input.runtime.ledger, chatId)) throw new Error("LOCAL_EXECUTION_UNCONFIRMED");
  }
  private update(chatId: string, value: Progress) {
    this.progress.delete(chatId); this.progress.set(chatId, value);
    for (const id of this.progress.keys()) { if (this.progress.size <= 100) break; if (!this.flights.has(id)) this.progress.delete(id); }
    this.input.changed();
  }
  async read(chatId: string): Promise<ExecutionView> {
    const identity = this.scope(), scope = { environment: identity.environment, userId: identity.userId };
    const state = await this.input.owners.chats.sync.read(scope, { type: "local-execution", chatId });
    if (this.scope().userId !== scope.userId) throw new Error("EXECUTION_ACCOUNT_UNAVAILABLE");
    const head = state.type === "local-execution" ? state.value?.head ?? null : null;
    const progress = this.progress.get(chatId), owned = head?.ownerDeviceId === this.input.deviceId;
    let reason: ExecutionReason | null = state.type === "local-execution" && state.value?.deleted ? "deleted" : !head ? "unavailable" : head.chat.classification.conversationKind !== "ordinary" ? "app" : head.archivedAt !== null ? "archived" :
      this.input.binding.snapshot()?.paused ? "paused" : this.input.account.snapshot().status !== "ready" ? "offline" : null;
    if (!reason && !owned && head?.openTurnId) reason = "running";
    if (!reason) try { this.assertIdle(chatId); } catch { reason = "local-busy"; }
    const metadata = this.input.owners.chats.getMetadata(chatId), readonly = head?.kind === "external-readonly";
    const busy = this.flights.has(chatId), prepared = owned && !readonly && Boolean(head && preparationReady(head, this.input.deviceId)) &&
      Boolean(metadata && metadata.readOnlyReason !== "external-readonly");
    return { head, localDeviceId: this.input.deviceId, residence: state.type === "local-execution" ? state.value?.residence ?? null : null,
      canPrepare: !reason && !busy && Boolean(owned && !readonly && !prepared),
      phase: reason === "deleted" ? "blocked" : busy ? progress?.phase ?? "claiming" : prepared ? "ready" : progress?.phase === "blocked" || head?.executionPreparation?.state === "blocked" ? "blocked" : "idle",
      reason: reason ?? (prepared ? null : progress?.reason ?? head?.executionPreparation?.reason ?? null), homeOmitted: progress?.homeOmitted ?? 0, backends: [] };
  }
  prepare(chatId: string) { return this.start(chatId); }
  async bindProject(chatId: string) {
    const identity = this.scope(), initial = await this.read(chatId), projectId = initial.head?.chat.classification.projectId;
    if (!projectId || initial.head?.chat.classification.conversationKind !== "ordinary" || !this.input.bindProject) throw new Error("PROJECT_WORKSPACE_PREPARATION_REQUIRED");
    const current = async () => {
      if (hashChatContent(this.scope()) !== hashChatContent(identity)) throw new Error("EXECUTION_ACCOUNT_CHANGED");
      this.assertIdle(chatId); const view = await this.read(chatId);
      if (view.head?.chat.incarnationId !== initial.head?.chat.incarnationId || view.head?.chat.classification.projectId !== projectId ||
        view.head.chat.classification.conversationKind !== "ordinary" || view.head.archivedAt !== null || view.reason === "deleted") throw new Error("EXECUTION_IDENTITY_CHANGED");
    };
    const result = await this.input.bindProject(projectId, { environment: identity.environment, userId: identity.userId }, current);
    this.input.changed(); if (result && (await this.read(chatId)).canPrepare) await this.prepare(chatId); return result;
  }
  async draft(input: { chatId: string; incarnationId: string }, change?: { expectedRevision: number; text: string }) {
    const identity = this.scope(), view = await this.read(input.chatId);
    if (view.head?.chat.incarnationId !== input.incarnationId || view.head.chat.classification.conversationKind !== "ordinary") throw new Error("EXECUTION_IDENTITY_CHANGED");
    const current = () => { if (hashChatContent(this.scope()) !== hashChatContent(identity)) throw new Error("EXECUTION_ACCOUNT_CHANGED"); };
    const result = await this.drafts.access({ ...input, userId: identity.userId }, current, change); current(); return result;
  }
  private start(chatId: string) {
    const identity = this.scope(true), previous = this.flights.get(chatId);
    if (previous) return previous.promise;
    if (this.flights.size >= 4) throw new Error("EXECUTION_PREPARATION_LIMIT");
    const abort = new AbortController();
    // Register cancellation before the first asynchronous read can begin.
    const disown = this.input.own({ close: async () => { abort.abort(); await flight.promise; } });
    const promise = Promise.resolve().then(() => this.run(chatId, identity, abort.signal)).finally(() => {
      disown(); this.flights.delete(chatId); this.input.changed();
    });
    const flight: Flight = { userId: identity.userId, promise, abort }; this.flights.set(chatId, flight); return promise;
  }
  private async run(chatId: string, identity: ReturnType<CloudExecutionService["scope"]>, signal: AbortSignal) {
    const { config, deviceId, transport, owners } = this.input;
    const crypto = this.input.filePorts(identity.userId).crypto();
    const scope = { environment: identity.environment, userId: identity.userId }, header = { ...protocolHeader(config), expectedUserId: identity.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    let remoteHead: EncryptedChatHead | null = null;
    const current = () => { signal.throwIfAborted(); if (this.input.filePorts(identity.userId).crypto().session.sessionId !== crypto.session.sessionId || hashChatContent(this.scope(true)) !== hashChatContent(identity)) throw new Error("EXECUTION_ACCOUNT_CHANGED"); };
    const read = async () => { current(); const head = await transport.query("chats/metadata:head", { ...header, chatId }); current(); if (!head) throw new Error("EXECUTION_IDENTITY_CHANGED"); remoteHead = head;
      const opened = await openChatHeadForRequest(head, chatId, crypto, signal); current(); return opened; };
    const accept = async (head: CloudChatHead) => { current(); await owners.chats.sync.mutate(scope, hashChatContent(["execution-head", scope, head]), { type: "put-mirror-head", head }); current(); this.input.changed(); };
    let head: CloudChatHead | null = null, files: DesktopBlobStore | null = null;
    this.update(chatId, { phase: "claiming", reason: null, homeOmitted: 0 });
    try {
      head = await read(); this.assertIdle(chatId);
      if (head.chat.classification.conversationKind !== "ordinary" || head.archivedAt !== null) throw new Error("chat-not-executable");
      if (head.ownerDeviceId !== deviceId || head.kind === "external-readonly") throw new Error("EXECUTION_IDENTITY_CHANGED");
      await accept(head);
      const pendingCreation = remoteHead as EncryptedChatHead | null;
      if (pendingCreation?.remoteCreation) {
        const existing = await owners.chats.sync.read(scope, { type: "remote-initial", chatId }); current();
        if (existing.type !== "remote-initial") throw new Error("REMOTE_INITIAL_UNAVAILABLE");
        let frozen = existing.value;
        if (frozen && (frozen.creationHash !== pendingCreation.remoteCreation.ciphertextHash || frozen.chatId !== pendingCreation.chat.id ||
          frozen.incarnationId !== pendingCreation.chat.incarnationId)) throw new Error("REMOTE_INITIAL_IDENTITY_CONFLICT");
        if (!frozen) {
          const prepared = await prepareRemoteChatInitialization(pendingCreation, crypto, signal); current();
          if (prepared.creationHash !== pendingCreation.remoteCreation.ciphertextHash) throw new Error("REMOTE_INITIAL_IDENTITY_CONFLICT");
          const saved = await owners.chats.sync.mutate(scope, hashChatContent(["remote-initial", scope, prepared]), { type: "freeze-remote-initial", initialization: prepared }); current();
          if (saved.result.type !== "freeze-remote-initial") throw new Error("REMOTE_INITIAL_UNAVAILABLE"); frozen = saved.result.value;
        }
        frozen = frozenRemoteChatInitializationSchema.parse(frozen);
        if (frozen.creationHash !== pendingCreation.remoteCreation.ciphertextHash || frozen.chatId !== pendingCreation.chat.id ||
          frozen.incarnationId !== pendingCreation.chat.incarnationId) throw new Error("REMOTE_INITIAL_IDENTITY_CONFLICT");
        const result = await transport.mutate("remote/chats:initialize", { ...header, initialization: frozen }); current();
        head = await openChatHeadForRequest(result, chatId, crypto, signal); current(); await accept(head);
      }
      if (preparationReady(head, deviceId) && owners.chats.getMetadata(chatId) && owners.chats.getMetadata(chatId)?.readOnlyReason !== "external-readonly") {
        this.update(chatId, { phase: "ready", reason: null, homeOmitted: 0 }); return;
      }
      files = new DesktopBlobStore(this.input.userData, { ...config, userId: scope.userId }, this.input.filePorts(scope.userId));
      const materializer = new CloudChatMaterializer({ ...this.input, ...owners, crypto: () => this.input.filePorts(identity.userId).crypto(), scope, files, signal, current, assertIdle: id => this.assertIdle(id),
        progress: phase => { current(); this.update(chatId, { phase, reason: null, homeOmitted: 0 }); } });
      const result = await materializer.ensureExecutionReady(head); current();
      this.update(chatId, { phase: "ready", reason: null, homeOmitted: result.home.omitted.length });
    } catch (error) {
      if (!signal.aborted) {
        try {
          current(); const reason = preparationReason(error);
          if (head?.ownerDeviceId === deviceId) {
            const actual = await read();
            if (actual.ownerDeviceId === deviceId && actual.chat.incarnationId === head.chat.incarnationId && actual.archivedAt === null) {
              await accept(await openChatHeadForRequest(await transport.mutate("turns/owner:prepare", { ...header, chatId, incarnationId: head.chat.incarnationId,
                bodyRevision: actual.bodyRevision, homeSnapshotId: actual.homeSnapshotId, state: "blocked", reason: reason === "project-unbound" ? reason : reason === "home-unavailable" ? reason : reason === "body-unavailable" ? reason : "identity-changed" }), chatId, crypto, signal));
            }
          }
          current(); this.update(chatId, { phase: "blocked", reason, homeOmitted: 0 });
        } catch { /* The current account or owner may already have changed. */ }
      }
    } finally { await files?.close(); }
  }
  private accountChanged() {
    let identity = "";
    try { identity = hashChatContent(this.scope(true)); } catch { /* Offline or revoked scopes cannot prepare. */ }
    if (identity !== this.identity) {
      this.identity = identity; for (const flight of this.flights.values()) flight.abort.abort(); this.progress.clear(); this.input.changed();
      if (identity) this.resumePending();
    }
  }
  private resumePending() {
    if (this.recovering || !this.identity || this.closed) return;
    const identity = this.identity;
    this.recovering = this.recover().catch(() => {}).finally(() => {
      this.recovering = null; if (this.identity !== identity) this.resumePending();
    });
  }
  private async recover() {
    const identity = this.scope(true); let afterRevision = 0, throughRevision: number | null = null;
    for (;;) {
      if (hashChatContent(this.scope(true)) !== hashChatContent(identity)) return;
      const page = await this.input.owners.chats.sync.read({ environment: identity.environment, userId: identity.userId }, { type: "confirmed-catalog", afterRevision, throughRevision });
      if (page.type !== "confirmed-catalog") return;
      for (const head of page.value.items) if (head.ownerDeviceId === this.input.deviceId &&
        (head.executionPreparation?.state === "pending" || head.executionPreparation?.state === "blocked")) await this.prepare(head.chat.id);
      if (page.value.complete) return; afterRevision = page.value.cursor!; throughRevision = page.value.revision;
    }
  }
  async close() { this.closed = true; this.unsubscribe(); for (const flight of this.flights.values()) flight.abort.abort(); await Promise.allSettled([...this.flights.values()].map(value => value.promise)); await this.recovering; await this.drafts.close(); this.progress.clear(); }
}
function preparationReason(error: unknown): ExecutionReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/PROJECT_/.test(message)) return "project-unbound";
  if (/HOME_|home-/.test(message)) return "home-unavailable";
  if (/LOCAL_EXECUTION|ADMISSION_BUSY/.test(message)) return "local-busy";
  if (/execution-running|SETTLEMENT_PENDING/.test(message)) return "running";
  if (/BODY_|MIRROR_|IMPORT_|ATTACHMENT_|file-|blob-|DOWNLOAD_/.test(message)) return "body-unavailable";
  if (/IDENTITY_|not-owner|incarnation/.test(message)) return "identity-changed";
  return "unavailable";
}
