/**
 * [INPUT]: Depends on current account/binding, confirmed ChatStore transactions, private files and the main transport.
 * [OUTPUT]: Carries the verified historical source Agent into imported transcript pages; Exposes account-fenced reading, retained catalogs, reviewed Project deletion recovery and original Chat fact/deletion decisions.
 * [POS]: Desktop read composition; mirrored App classifications never become executable local aggregates.
 */
import { cloudFunctions, protocolHeader, type BlobTransferPorts, type CloudBuildConfig, type CloudFunctionArgs } from "@ai-chat/cloud-protocol";
import { openChatReadResult, type ChatQueryInput, type ChatQueryName, type ChatQueryResult } from "@ai-chat/chat-ui/read-source";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { readChatBody } from "@ai-chat/cloud-protocol/chats/transcript/reader";
import type { TurnReceiptReader } from "@ai-chat/cloud-protocol/turns/encrypted/receipt";
import { transcriptPageSchema, type TranscriptRequest } from "@ai-chat/chat-ui/model";
import type { ChatSyncStore } from "../sync/chats/sources";
import type { SyncBindingStore } from "../sync/account/binding";
import type { CloudAccountService } from "../runtime/service";
import type { CloudTransport } from "../runtime/transport";
import { DesktopBlobStore } from "../files/store";
import { ChatFileLeases } from "./files";
import { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { readLibraryCloudAttachment } from "../../library/assets/remote";
import type { RecoveryContent } from "./recovery/content";
import type { RecoveryIdentity } from "../../../../shared/cloud/recovery";
import type { CloudProjectRemoval } from "../sync/deletion/projects/removal";
import type { ProjectDeletionDecision } from "../../../../shared/cloud/projects/deletion";
import type { ChatFactsEdit, ChatFactsDecision } from "../../../../shared/cloud/facts";
import type { ChatDeletionRequest, ChatDeletionKeep } from "../../../../shared/cloud/deletion";
import { ChangeNotifier } from "../runtime/notifier";
export class CloudChatReader {
  private closed = false;
  private identity = "";
  private generation = 0;
  private files: ChatFileLeases | null = null;
  private stops = new Set<() => void>();
  private readonly listeners = new ChangeNotifier();
  private readonly closingFiles = new Set<Promise<void>>();
  private readonly stopAccount: () => void;
  constructor(private readonly ports: { crypto(): FileCipherPort; config: CloudBuildConfig; userData: string; binding: Pick<SyncBindingStore, "snapshot">; account: Pick<CloudAccountService, "snapshot" | "subscribe">;
    store: ChatSyncStore; recovery?: RecoveryContent; projectRemoval?: CloudProjectRemoval; transport: Pick<CloudTransport, "query" | "watchChatRead">; filePorts(userId: string): BlobTransferPorts; openChat(chatId: string): Promise<void>;
    libraryRoot?(): string | null; factsChanged?(): void; own(activity: { close(): Promise<void> }): () => void }) {
    this.stopAccount = ports.account.subscribe(() => {
      const account = ports.account.snapshot(), binding = ports.binding.snapshot();
      const key = binding && binding.phase !== "closing" && account.profile?.userId === binding.userId && ["ready", "temporarily-offline"].includes(account.status) ? binding.userId : "";
      if (key !== this.identity) { this.identity = key; this.generation++; this.clear(); this.changed(); }
    });
  }
  private scope() {
    const account = this.ports.account.snapshot(), binding = this.ports.binding.snapshot();
    if (this.closed || !binding || binding.phase === "closing" || account.profile?.userId !== binding.userId ||
      account.deviceId !== binding.deviceId || !["ready", "temporarily-offline"].includes(account.status)) throw new Error("CHAT_ACCOUNT_UNAVAILABLE");
    return { environment: this.ports.config.environmentId, userId: binding.userId };
  }
  private async fenced<T>(run: (scope: ReturnType<CloudChatReader["scope"]>) => Promise<T>) {
    const generation = this.generation, scope = this.scope(), result = await run(scope);
    if (generation !== this.generation || this.scope().userId !== scope.userId) throw new Error("CHAT_ACCOUNT_CHANGED"); return result;
  }
  subscribe = this.listeners.subscribe;
  changed() { this.listeners.notify(); }
  deletion(chatId: string) {
    return this.fenced(async scope => {
      const result = await this.ports.store.read(scope, { type: "chat-deletion", chatId });
      if (result.type !== "chat-deletion") throw new Error("CHAT_DELETION_UNAVAILABLE"); return result.value;
    });
  }
  async requestDeletion(input: ChatDeletionRequest) {
    await this.fenced(scope => this.ports.store.mutate(scope, input.operationId, { type: "request-chat-deletion", ...input }));
    this.ports.factsChanged?.(); this.changed(); return this.deletion(input.chatId);
  }
  async keepDeletion(input: ChatDeletionKeep) {
    await this.fenced(scope => this.ports.store.mutate(scope, input.operationId, { type: "keep-chat-deletion", ...input }));
    this.ports.factsChanged?.(); this.changed(); return this.deletion(input.chatId);
  }
  facts(chatId: string) {
    return this.fenced(async scope => {
      const result = await this.ports.store.read(scope, { type: "chat-facts", chatId });
      if (result.type !== "chat-facts") throw new Error("CHAT_METADATA_UNAVAILABLE"); return result.value;
    });
  }
  async editFacts(input: ChatFactsEdit) {
    await this.fenced(scope => this.ports.store.mutate(scope, input.operationId, { type: "edit-chat-metadata", ...input }));
    this.ports.factsChanged?.(); this.changed(); return this.facts(input.chatId);
  }
  async resolveFacts(input: ChatFactsDecision) {
    await this.fenced(scope => this.ports.store.mutate(scope, input.operationId, { type: "resolve-chat-facts", ...input }));
    this.ports.factsChanged?.(); this.changed(); return this.facts(input.chatId);
  }
  private recovery() { if (!this.ports.recovery) throw new Error("RECOVERY_UNAVAILABLE"); return this.ports.recovery; }
  private projectRecovery() { if (!this.ports.projectRemoval) throw new Error("PROJECT_RECOVERY_UNAVAILABLE"); return this.ports.projectRemoval.recovery(); }
  projectDeletionCatalog(input: { afterId: string | null }) { return this.fenced(async scope => this.projectRecovery().list(scope, input.afterId)); }
  reviewProjectDeletion(projectId: string) { return this.fenced(scope => this.projectRecovery().review(scope, projectId)); }
  resolveProjectDeletion(input: ProjectDeletionDecision) { return this.fenced(scope => this.projectRecovery().decide(scope, input)); }
  retryProjectDeletion(projectId: string) { return this.fenced(scope => this.projectRecovery().retry(scope, projectId)); }
  retainedCatalog(input: { afterId: string | null }) {
    return this.fenced(async scope => {
      const result = await this.ports.store.read(scope, { type: "retained-catalog", ...input });
      if (result.type !== "retained-catalog") throw new Error("RECOVERY_CATALOG_UNAVAILABLE"); return result.value;
    });
  }
  retainedMetadata(input: RecoveryIdentity & { before: number | null }) {
    return this.fenced(async scope => {
      const result = await this.ports.store.read(scope, { type: "retained-metadata", ...input });
      if (result.type !== "retained-metadata") throw new Error("RECOVERY_CANDIDATE_UNAVAILABLE"); return result.value;
    });
  }
  recoveryPage(input: RecoveryIdentity & { before: number | null }) {
    return this.fenced(scope => this.recovery().page(scope, input, new AbortController().signal));
  }
  recoveryFile(input: Parameters<RecoveryContent["file"]>[1]) {
    return this.fenced(scope => this.fileLeases().openCaptured(signal => this.recovery().file(scope, input, signal)));
  }
  catalog(input: { afterRevision: number; throughRevision: number | null }) {
    return this.fenced(async scope => { const value = await this.ports.store.read(scope, { type: "confirmed-catalog", ...input });
      if (value.type !== "confirmed-catalog") throw new Error("CHAT_CATALOG_UNAVAILABLE"); return value.value; });
  }
  head(chatId: string) {
    return this.fenced(async scope => { const value = await this.ports.store.read(scope, { type: "chat-metadata", chatId });
      if (value.type !== "chat-metadata") throw new Error("CHAT_HEAD_UNAVAILABLE"); return value.value.head; });
  }
  async transcript(input: TranscriptRequest) {
    let request = input;
    for (let attempt = 0; ; attempt++) {
      try { return await this.readTranscript(request); }
      catch (error) {
        if (attempt >= 2 || request.beforeSeq !== null || !/MIRROR_HEAD_CHANGED|MIRROR_BODY_CURSOR_CHANGED|CHAT_BODY_CHANGED|IMPORT_GENERATION_CHANGED/.test(String(error))) throw error;
        request = { ...request, revision: null, generationId: null };
      }
    }
  }
  private async readTranscript(input: TranscriptRequest) {
    if (input.segment === "imported") return this.imported(input);
    return this.fenced(async scope => {
      const head = await this.head(input.chatId); if (!head) throw new Error("CHAT_HEAD_UNAVAILABLE");
      if (input.revision !== null && input.revision !== head.bodyRevision) throw new Error("CHAT_BODY_CHANGED");
      let value = await this.ports.store.read(scope, { type: "confirmed-body-page", chatId: input.chatId, revision: head.bodyRevision, beforeSeq: input.beforeSeq, limit: input.limit });
      if (value.type !== "confirmed-body-page") throw new Error("CHAT_BODY_UNAVAILABLE");
      if (!value.value.ready && this.ports.account.snapshot().status === "ready") {
        await this.ports.openChat(input.chatId);
        value = await this.ports.store.read(scope, { type: "confirmed-body-page", chatId: input.chatId, revision: head.bodyRevision, beforeSeq: input.beforeSeq, limit: input.limit });
        if (value.type !== "confirmed-body-page") throw new Error("CHAT_BODY_UNAVAILABLE");
      }
      return transcriptPageSchema.parse({ chatId: input.chatId, incarnationId: head.chat.incarnationId, segment: "native", revision: head.bodyRevision,
        generationId: null, state: value.value.ready ? "ready" : "pending", messages: value.value.messages, cursor: value.value.cursor, complete: value.value.complete });
    });
  }
  private async imported(input: TranscriptRequest) {
    return this.fenced(async scope => {
      const head = await this.head(input.chatId); if (!head) throw new Error("CHAT_HEAD_UNAVAILABLE");
      if (head.kind === "native") return transcriptPageSchema.parse({ chatId: input.chatId, incarnationId: head.chat.incarnationId,
        segment: "imported", messages: [], imported: [], revision: 0, generationId: null, state: "ready", cursor: null, complete: true });
      const read = () => this.ports.store.read(scope, { type: "confirmed-import-page", chatId: input.chatId, generationId: input.generationId,
        revision: input.revision, beforeSeq: input.beforeSeq, limit: input.limit });
      let result = await read(); if (result.type !== "confirmed-import-page") throw new Error("IMPORT_CACHE_UNAVAILABLE");
      if ((!result.value.state?.complete || result.value.state.bodyRevision !== head.bodyRevision) && this.ports.account.snapshot().status === "ready") {
        await this.ports.openChat(input.chatId); result = await read(); if (result.type !== "confirmed-import-page") throw new Error("IMPORT_CACHE_UNAVAILABLE");
      }
      const page = result.value, state = page.state, ready = state?.complete && state.bodyRevision === head.bodyRevision;
      return transcriptPageSchema.parse({ chatId: input.chatId, incarnationId: head.chat.incarnationId, segment: "imported", messages: [],
        importedBackend: state?.status.manifest.sourceKind, revision: state?.status.revision ?? 0, generationId: state?.status.manifest.generationId ?? null,
        state: !ready ? "pending" : state.status.manifest.incompleteTail ? "partial" : "ready", imported: page.entries, cursor: page.cursor, complete: page.complete });
    });
  }
  private readHeader() {
    const crypto = this.ports.crypto(), scope = this.scope();
    if (crypto.session.userId !== scope.userId) throw new Error("CHAT_ACCOUNT_CHANGED");
    return { ...protocolHeader(this.ports.config), expectedUserId: scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  }
  private async readBlock(chatId: string, bodyHash: string, blockId: string, signal: AbortSignal) {
    signal.throwIfAborted(); const value = await this.ports.transport.query("chats/body/reads:block", { ...this.readHeader(), chatId, bodyHash, blockId });
    signal.throwIfAborted(); return value;
  }
  private async readBlocks(chatId: string, blocks: { bodyHash: string; blockId: string }[], signal: AbortSignal) {
    signal.throwIfAborted();
    const value = await this.ports.transport.query("chats/body/reads:blocks", { ...this.readHeader(), chatId, blocks });
    signal.throwIfAborted(); return value;
  }
  private turnReader(): TurnReceiptReader {
    const readPrefixPage: TurnReceiptReader["readPrefixPage"] = async (chatId, turnId, afterSeq, throughSeq, signal) => {
      signal.throwIfAborted(); const value = await this.ports.transport.query("turns/reads:page", { ...this.readHeader(), chatId, turnId, afterSeq, throughSeq });
      signal.throwIfAborted(); return value;
    };
    return { readPrefixPage, readResult: async (chatId, incarnationId, messageId, bodyHash, signal) => {
      signal.throwIfAborted(); const projection = await this.ports.transport.query("chats/body/reads:get", { ...this.readHeader(), chatId, messageId });
      signal.throwIfAborted();
      if (!projection || projection.bodyHash !== bodyHash) throw new Error("TURN_RESULT_CHANGED");
      return readChatBody(projection, { id: chatId, incarnationId }, { crypto: this.ports.crypto,
        readBlock: this.readBlock.bind(this), readPrefixPage }, signal);
    } };
  }
  query<N extends ChatQueryName>(name: N, input: ChatQueryInput<N>) {
    return this.fenced(async () => {
      const controller = new AbortController(), crypto = this.ports.crypto();
      const stop = () => controller.abort(); this.stops.add(stop);
      try {
        const result = await this.ports.transport.query(name, cloudFunctions[name].args.parse({ ...input, ...this.readHeader() }) as CloudFunctionArgs<N>);
        return await openChatReadResult(name, result, crypto, controller.signal, { input, readBlock: this.readBlock.bind(this), readBlocks: this.readBlocks.bind(this), turnReader: this.turnReader() });
      } finally { this.stops.delete(stop); }
    });
  }
  watch<N extends ChatQueryName>(name: N, input: ChatQueryInput<N>, changed: (value: ChatQueryResult<N>) => void, failed: () => void) {
    const scope = this.scope(), generation = this.generation, crypto = this.ports.crypto();
    if (this.stops.size >= 12) throw new Error("CHAT_SUBSCRIPTION_LIMIT");
    let version = 0, live = true, pending: AbortController | null = null;
    const current = () => { try { return live && generation === this.generation && this.scope().userId === scope.userId; } catch { return false; } };
    const unsubscribe = this.ports.transport.watchChatRead(name, cloudFunctions[name].args.parse({ ...input, ...this.readHeader() }) as CloudFunctionArgs<N>,
      value => {
        if (!current()) return;
        const revision = ++version; pending?.abort(); const controller = new AbortController(); pending = controller;
        void openChatReadResult(name, value, crypto, controller.signal, { input, readBlock: this.readBlock.bind(this), readBlocks: this.readBlocks.bind(this), turnReader: this.turnReader() }).then(result => {
          if (current() && version === revision && !controller.signal.aborted) changed(result);
        }).catch(() => { if (current() && version === revision && !controller.signal.aborted) failed(); });
      }, () => { if (current()) failed(); });
    const stop = () => { live = false; pending?.abort(); this.stops.delete(stop); unsubscribe(); }; this.stops.add(stop); return stop;
  }
  private fileLeases() {
    const scope = this.scope(), generation = this.generation;
    if (this.files) return this.files;
    const files = new ChatFileLeases(new DesktopBlobStore(this.ports.userData, { environmentId: scope.environment,
      deploymentId: this.ports.config.deploymentId, userId: scope.userId }, this.ports.filePorts(scope.userId)), () => {
      if (generation !== this.generation || this.scope().userId !== scope.userId) throw new Error("CHAT_ACCOUNT_CHANGED");
    });
    let release = () => {};
    try { release = this.ports.own({ close: async () => { await files.close(); if (this.files === files) this.files = null; release(); } }); }
    catch (error) { void files.close(); throw error; }
    this.files = files; return files;
  }
  async openFile(input: Parameters<ChatFileLeases["open"]>) {
    return this.fenced(async scope => {
      const head = await this.head(input[0]); if (!head) throw new Error("CHAT_HEAD_UNAVAILABLE");
      if (!this.ports.libraryRoot?.()) return this.fileLeases().open(...input);
      const generation = this.generation;
      const current = () => { if (generation !== this.generation || this.scope().userId !== scope.userId) throw new Error("CHAT_ACCOUNT_CHANGED"); };
      return this.fileLeases().openCaptured(async signal => {
        const files = new EncryptedBlobTransfer(this.ports.filePorts(scope.userId));
        try { return await readLibraryCloudAttachment({ root: this.ports.libraryRoot!, store: this.ports.store, head, scope, files,
          crypto: this.ports.crypto, current, signal }, input[1]); }
        finally { await files.close(); }
      });
    });
  }
  readFile(leaseId: string, offset: number, length: number) { return this.fileLeases().read(leaseId, offset, length); }
  closeFile(leaseId: string) { return this.files?.release(leaseId); }
  private clear() { for (const stop of [...this.stops]) stop(); const files = this.files; this.files = null;
    if (files) { const flight = files.close(); this.closingFiles.add(flight); void flight.finally(() => this.closingFiles.delete(flight)).catch(() => {}); } }
  async close() { this.closed = true; this.generation++; this.stopAccount(); this.clear(); this.listeners.clear(); await Promise.allSettled(this.closingFiles); }
}
