/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and Electron BrowserWindow, owner-aware Bases schemas, canonical Chat/Project records, BaseStore/owner resolution, row mutation, IO, promotion, attachment, and file-dialog ports, plus the shared statusError constructor from main/errors; who may write is decided by BaseMutationAuthority (./mutation-authority), which it holds and delegates the issuers to
 * [OUTPUT]: Provides ownerKey CRUD/CAS/LWW, the explicit Create Base of a Project with none (ensure never creates one), stable Agent batch results, pre-copy Query snapshots, on-screen read evidence for cloud subscriptions, replay-aware App GUI commands, exact App-renderer fences, retained navigation, migration guards, attachments and format IO, and onBaseEvent for main-process subscribers. The workflow authority (issueWorkflowMutationAuthority) takes only a live workflow-run principal as its evidence.
 * [POS]: Bases application service; owner and trusted App-renderer boundaries are resolved here while format IO and cross-store promotion remain delegated
 */

import type { BrowserWindow } from "electron";
import { type BaseExportResult, type BaseAttachmentValue, type BaseMetaPatch, type BaseRow, type BaseRowPatch, type BasesEvent, type BaseSnapshot, type ListGalleryEntriesInput, type PutAttachmentInput, type PutAttachmentRequest, type PutAttachmentResult, type ReadAttachmentThumbnailInput } from "../../../shared/bases/model/bases-ipc";
import { ownerKeyOf } from "@ai-chat/base-core/model/owner-key";
import { putAttachmentInputSchema } from "../../../shared/bases/gallery-attachments";
import type { BaseHistoryActor } from "../../../shared/bases/history-ledger-schema";
import { baseSnapshotFile, type BaseSnapshotFile } from "../../../shared/bases/model/base-snapshot";
import type { AppBaseDataMigrationFile } from "../../../shared/apps/model/app-data-migration";
import type { BaseGuiLiveBinding } from "../../../shared/ipc/apps/apps-ipc";
import type { ChatRecord } from "../../../shared/ipc/content/chats-ipc";
import { BaseConflictError, BaseStore } from "./base-store";
import { codedError } from "./base-store-model";
import type { CompletedImageEventV1 } from "../gallery/turn-events-broker";
import type { GalleryMediaSourceRef } from "../../../shared/ipc/content/gallery-media-ipc";
import { BaseAttachmentService } from "./attachment/attachment-service";
import { BaseImageService } from "./attachment/image-service";
import {
  BaseOwnerResolver,
  type BaseChatRef,
  type BaseLeaseIdentity,
} from "./service/base-owner-resolver";
import type { BasePromotionService } from "./base-promotion-service";
import { BaseIoFacade } from "./service/base-io-facade";
import {
  BaseCommitAuthorityRegistry,
  type BaseCommitAuthority,
  type BaseMutationOperation,
} from "./service/base-commit-authority";
import { BaseRowMutations } from "./service/base-row-mutations";
import { BaseAppGuiMutations } from "./service/base-app-gui-mutations";
import { registerBasesRendererIpc } from "./service/bases-renderer-ipc";
import { RetainedBaseNavigation } from "./navigation/retained-service";
import { BaseEventPublisher } from "./service/base-event-publisher";
import { statusError, withDeadline } from "../ipc/errors";
import { BaseMutationAuthority, type BaseAppSurfaceValidator } from "./mutation-authority";
import type { VerifiedPrincipal } from "../operations/principals";

export type BasesServiceOptions = {
  getChat(chatId: string): Promise<BaseChatRef | null>;
  getProject?(
    projectId: string
  ): { id: string; name: string; archivedAt?: number } | undefined;
  chooseExportPath?(
    suggestedName: string,
    format?: "csv" | "json" | "xlsx"
  ): Promise<string | null>;
  chooseImportPath?(format?: "json" | "xlsx"): Promise<string | null>;
  writeExport?: (path: string, content: string) => Promise<void>;
  onEvent?(event: BasesEvent): void;
  onRetainedBaseRemoved?(projectId: string): Promise<void>;
  now?: () => number;
};
export { BaseConflictError };
/** How long an open waits for the deferred startup pass before it reports the Base as still loading. */
const BASE_LOADING_WAIT_MS = 10_000;

export class BasesService {
  private admission: "accepting" | "draining" | "closed" = "accepting";
  private readonly now: () => number;
  private readonly attachmentService: BaseAttachmentService;
  private readonly imageService: BaseImageService;
  private readonly io: BaseIoFacade;
  private readonly rowMutations: BaseRowMutations;
  private readonly appGuiMutations: BaseAppGuiMutations;
  private readonly retainedNavigation: RetainedBaseNavigation;
  private readonly events: BaseEventPublisher;
  private readonly commitAuthorities = new BaseCommitAuthorityRegistry();
  private readonly mutationAuthority: BaseMutationAuthority;
  readonly ownerResolver: BaseOwnerResolver;
  private promotion: BasePromotionService | null = null;
  constructor(
    readonly store: BaseStore,
    options: BasesServiceOptions
  ) {
    this.now = options.now ?? Date.now;
    this.events = new BaseEventPublisher(options.onEvent);
    this.ownerResolver = new BaseOwnerResolver(store, {
      getChat: options.getChat,
      getProject: (projectId) => options.getProject?.(projectId),
    });
    this.mutationAuthority = new BaseMutationAuthority(store, this.ownerResolver, this.commitAuthorities);
    this.attachmentService = new BaseAttachmentService(store, {
      identity: (chatId) => this.attachmentIdentity(chatId),
      ownerIdentity: async (ownerKey) => {
        const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
        return { ...identity, ownerKey };
      },
      authorizeDestination: async (ownerKey, ownerInstanceId, chatId) => {
        const chat = await this.ownerResolver.chat(chatId);
        const snapshot = this.store.get(ownerKey, ownerInstanceId);
        if (!snapshot) throw statusError(404, "Attachment source 不存在");
        const principal = await this.ownerResolver.resolvePrincipal(
          snapshot.meta,
          { chatId: chat.id, incarnationId: chat.incarnationId }
        );
        if (!principal) throw statusError(403, "目标 chat 无权读取 source Base");
      },
      assertAdmission: () => this.assertAdmission(),
      emitChange: (snapshot, delta) => this.events.changed(snapshot, delta),
      now: this.now,
    });
    this.io = new BaseIoFacade(store, {
      chooseExportPath: options.chooseExportPath,
      chooseImportPath: options.chooseImportPath,
      writeExport: options.writeExport,
      now: this.now,
      requireOwner: (ownerKey) => this.mutationAuthority.requireOwner(ownerKey),
      mutationIdentity: (ownerKey, authority, operation) =>
        this.mutationAuthority.identity(ownerKey, authority, operation),
      assertAdmission: () => this.assertAdmission(),
      emitChange: (snapshot, delta) => this.events.changed(snapshot, delta),
    });
    this.rowMutations = new BaseRowMutations(store, {
      assertAdmission: () => this.assertAdmission(),
      mutationIdentity: (ownerKey, authority, operation) =>
        this.mutationAuthority.identity(ownerKey, authority, operation),
      mutationScope: (ownerKey, authority, operation, appFence) =>
        this.mutationAuthority.scope(ownerKey, authority, operation, appFence),
      emitChange: (snapshot, delta) => this.events.changed(snapshot, delta),
      conflict: (message) => new BaseConflictError(message),
    });
    this.imageService = new BaseImageService(this, {
      authorize: async (input, operation) => {
        this.assertAdmission();
        const authority = await this.mutationAuthority.forRenderer({ ...input, operation, expectedRevision: null });
        const identity = await this.mutationAuthority.identity(input.ownerKey, authority, operation);
        if (identity.ownerInstanceId !== input.ownerInstanceId) throw statusError(409, "Base owner instance changed", { code: "base_scope_changed" });
      },
      emit: (snapshot, rowId) => this.events.changed(snapshot, { upserts: snapshot.rows.filter(row => row.id === rowId) }),
    });
    this.appGuiMutations = new BaseAppGuiMutations(
      this.rowMutations,
      this.attachmentService,
      this.commitAuthorities,
      { requireOwner: (ownerKey) => this.mutationAuthority.requireOwner(ownerKey) }
    );
    this.retainedNavigation = new RetainedBaseNavigation(store, {
      now: this.now,
      clearFamily: (ownerKey, ownerInstanceId) =>
        this.attachmentService.clearFamily(ownerKey, ownerInstanceId),
      emit: (event) => this.events.publish(event),
      onRemoved: options.onRetainedBaseRemoved,
    });
  }

  configurePromotion(service: BasePromotionService) {
    if (this.promotion) throw new Error("Base promotion service 已配置");
    this.promotion = service;
  }

  configureAppSurfaceValidator(validator: BaseAppSurfaceValidator) {
    this.mutationAuthority.configureSurfaceValidator(validator);
  }

  publishEvent(event: BasesEvent) {
    this.events.publish(event);
  }

  onBaseEvent(listener: (event: BasesEvent) => void) { return this.events.subscribe(listener); }

  register(window: BrowserWindow, rendererUrl: string) {
    this.events.bind(window);
    this.imageService.register(window, rendererUrl);
    registerBasesRendererIpc(window, rendererUrl, this, {
      rendererAuthority: (input) => this.mutationAuthority.forRenderer(input),
      putAttachment: (input) => this.putAttachmentFromRenderer(input),
      promote: (input) => {
        if (!this.promotion) throw new Error("Base promotion 尚未初始化");
        return this.promotion.promote(input);
      },
      closed: () => {
        this.events.unbind(window);
      },
    });
  }

  async get(ownerKey: string): Promise<BaseSnapshot | null> {
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    const snapshot = this.store.get(ownerKey, identity.ownerInstanceId || undefined);
    // A renderer or App window asking for this Base is what tells cloud synchronization it is on screen.
    if (snapshot) this.store.noteSurfaceRead(ownerKey, snapshot.meta.ownerInstanceId);
    return snapshot;
  }

  async querySnapshot(ownerKey: string) {
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    const descriptor = await this.store.describeQuerySnapshot(
      ownerKey,
      identity.ownerInstanceId || undefined
    );
    if (descriptor) this.store.noteSurfaceRead(ownerKey, descriptor.baseInstanceId);
    return descriptor && {
      ...descriptor,
      copy: async () => this.store.copyQuerySnapshot({ ownerKey, ...descriptor }),
      currentIdentity: async () => {
        const current = this.store.peek(ownerKey);
        return current && {
          baseInstanceId: current.meta.ownerInstanceId,
          revision: current.meta.revision,
        };
      },
    };
  }

  rowHistory(ownerKey: string, rowId: string) {
    return this.io.rowHistory(ownerKey, rowId);
  }

  async ensure(ownerKey: string): Promise<BaseSnapshot> {
    this.assertAdmission();
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    if (!identity.ownerInstanceId) {
      throw statusError(404, "Project Base 尚未创建", { code: "base_not_found" });
    }
    try {
      return await this.store.ensure(identity);
    } catch (cause) {
      if ((cause as { code?: unknown }).code !== "base_loading") throw cause;
      /* An owner still on disk that the deferred startup pass has not loaded yet: that pass clears it by itself, so the
         open waits for it (bounded) and asks once more instead of showing an error for a state that is about to end. */
      await withDeadline(this.store.deferredSettled, BASE_LOADING_WAIT_MS, () => cause as Error);
      // Anything can change during the wait: admission, and the owner itself. Nothing checked before it is reused.
      this.assertAdmission();
      const current = await this.ownerResolver.identityForOwnerKey(ownerKey);
      if (!current.ownerInstanceId || current.ownerInstanceId !== identity.ownerInstanceId) {
        throw statusError(404, "Base owner 在等待期间已变化", { code: "base_not_found" });
      }
      return this.store.ensure(current);
    }
  }

  /**
   * The explicit "Create Base" of a Project that has none (General › Base, Project settings › Workflows). Read paths keep
   * `ensure`, which never creates a Project Base; a Chat Base still reaches a Project only by promotion.
   */
  async createProjectBase(projectId: string): Promise<BaseSnapshot> {
    this.assertAdmission();
    const { ownerInstanceId: _none, ...identity } = await this.ownerResolver.identityForOwnerKey(`project:${projectId}`);
    return this.store.ensureProjectBase(identity);
  }

  async snapshotForLease(
    chatId: string,
    incarnationId: string,
    ensure: boolean
  ) {
    const identity = await this.ownerResolver.resolveTargetForLease({
      chatId,
      incarnationId,
    });
    const ownerKey = ownerKeyOf(identity.owner);
    const snapshot = this.store.get(ownerKey, identity.ownerInstanceId);
    if (snapshot) return snapshot;
    if (!ensure) throw statusError(404, "Base 尚未创建", { code: "base_not_found" });
    this.assertAdmission();
    return this.store.ensure(identity);
  }

  /** 跨 Section 读路径：验证 canonical chat/incarnation，但绝不隐式创建 Base。 */
  async snapshotForRead(chatId: string) {
    const identity = await this.ownerResolver.resolveTargetForSection(chatId);
    return this.mutationAuthority.requireOwner(ownerKeyOf(identity.owner));
  }

  async resolveForSection(sectionId: string) {
    const identity = await this.ownerResolver.resolveTargetForSection(sectionId);
    const ownerKey = ownerKeyOf(identity.owner);
    const current = this.store.peek(ownerKey);
    return {
      ownerKey,
      ownerInstanceId: current?.meta.ownerInstanceId ?? identity.ownerInstanceId,
      status: current ? ("healthy" as const) : ("absent" as const),
    };
  }

  async summaryForSection(sectionId: string) {
    const identity = await this.ownerResolver.resolveTargetForSection(sectionId);
    const ownerKey = ownerKeyOf(identity.owner);
    const snapshot = this.store.get(ownerKey, identity.ownerInstanceId);
    return snapshot
      ? {
          ownerKey,
          owner:
            snapshot.meta.owner.kind === "chat"
              ? ("own" as const)
              : ("project" as const),
          rowCount: snapshot.rows.length,
        }
      : null;
  }

  async snapshotForApp(
    appId: string,
    lease: BaseLeaseIdentity,
    ensure = false
  ) {
    const identity = await this.ownerResolver.resolveTargetForApp(appId, lease);
    const ownerKey = ownerKeyOf(identity.owner);
    const snapshot = this.store.get(ownerKey, identity.ownerInstanceId);
    if (snapshot) return snapshot;
    if (!ensure) throw statusError(404, "App Base 尚未创建", { code: "base_not_found" });
    this.assertAdmission();
    return this.store.ensure(identity);
  }

  issueToolMutationAuthority(input: Parameters<BaseMutationAuthority["forTool"]>[0]) { return this.mutationAuthority.forTool(input); }
  issueSystemMutationAuthority(ownerKey: string, operation: BaseMutationOperation) { return this.mutationAuthority.forSystem(ownerKey, operation); }
  /** The only authority that may change a workflow-only column (Q12); see BaseMutationAuthority.forWorkflow. */
  issueWorkflowMutationAuthority(ownerKey: string, operation: BaseMutationOperation, principal: VerifiedPrincipal) {
    return this.mutationAuthority.forWorkflow(ownerKey, operation, principal);
  }

  assertAppRendererOwnerKey(ownerKey: string, appId: string) {
    return this.ownerResolver.assertOwnerKeyForApp(ownerKey, appId);
  }

  appRendererOwnerKey(appId: string) {
    return this.ownerResolver.ownerKeyForApp(appId);
  }

  async promoteRetainedAppBase(projectId: string) {
    return this.retainedNavigation.promote(projectId);
  }

  async removeManagedBase(ownerKey: string, ownerInstanceId: string) {
    return this.retainedNavigation.remove(ownerKey, ownerInstanceId);
  }

  /** App 包声明、平台执行；一个 owner queue、一个 revision、一次事件。 */
  async applyAppDataMigration(
    ownerKey: string,
    file: AppBaseDataMigrationFile,
    assertMutationAllowed?: () => void
  ) {
    return this.rowMutations.applyAppDataMigration(ownerKey, file, assertMutationAllowed);
  }

  async updateMeta(input: {
    ownerKey: string;
    expectedRevision: number;
    patch: BaseMetaPatch;
    authority: BaseCommitAuthority;
  }) {
    return this.rowMutations.updateMeta(input);
  }

  async insertRows(input: {
    ownerKey: string;
    rows: BaseRow[];
    authority: BaseCommitAuthority;
  }) {
    return this.rowMutations.insertRows(input);
  }

  toolRows(input: Parameters<BaseRowMutations["toolRows"]>[0]) {
    return this.rowMutations.toolRows(input);
  }

  toolMeta(input: Parameters<BaseRowMutations["toolMeta"]>[0]) {
    return this.rowMutations.toolMeta(input);
  }

  async insertRowsFromAppGui(input: {
    ownerKey: string;
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    rows: BaseRow[];
  }) {
    return this.appGuiMutations.insert(input);
  }

  patchRowsFromAppGui(input: {
    ownerKey: string;
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    patches: Array<{ rowId: string; patch: BaseRowPatch }>;
  }) {
    return this.appGuiMutations.patch(input);
  }

  deleteRowsFromAppGui(input: {
    ownerKey: string;
    binding: BaseGuiLiveBinding;
    expectedBaseInstanceId: string;
    expectedRevision: number;
    rowIds: string[];
  }) {
    return this.appGuiMutations.delete(input);
  }

  readAttachmentForAppGui(ownerKey: string, attachmentId: string) {
    return this.appGuiMutations.readAttachment(ownerKey, attachmentId);
  }

  async patchRow(input: {
    ownerKey: string;
    rowId: string;
    patch: BaseRowPatch;
    authority: BaseCommitAuthority;
  }) {
    return this.patchRows(
      input.ownerKey,
      [{ rowId: input.rowId, patch: input.patch }],
      input.authority
    );
  }

  async patchRows(
    ownerKey: string,
    patches: Array<{ rowId: string; patch: BaseRowPatch }>,
    authority: BaseCommitAuthority
  ) {
    return this.rowMutations.patchRows(ownerKey, patches, authority);
  }

  async deleteRows(input: {
    ownerKey: string;
    rowIds: string[];
    authority: BaseCommitAuthority;
    expectedRevision?: number;
  }) {
    return this.rowMutations.deleteRows(input);
  }

  async putAttachment(
    input: PutAttachmentInput,
    actor: BaseHistoryActor
  ): Promise<PutAttachmentResult> {
    return this.attachmentService.putAttachment(input, actor);
  }

  private async putAttachmentFromRenderer(
    input: PutAttachmentRequest
  ): Promise<PutAttachmentResult> {
    const { surfaceLeaseId, ...upload } = input;
    const authority = await this.mutationAuthority.forRenderer({
      ownerKey: upload.ownerKey,
      operation: "attachment-put",
      expectedRevision: upload.expectedRevision ?? null,
      ...(surfaceLeaseId ? { surfaceLeaseId } : {}),
    });
    const identity = await this.mutationAuthority.identity(
      upload.ownerKey,
      authority,
      "attachment-put"
    );
    if (identity.ownerInstanceId !== upload.ownerInstanceId) {
      throw new BaseConflictError("Attachment owner instance 已变化");
    }
    return this.putAttachment(
      putAttachmentInputSchema.parse(upload),
      authority.actor
    );
  }

  async ingestCompletedImage(
    event: CompletedImageEventV1,
    bytes: Buffer,
    filename = `${event.sourceRef.itemId}.png`,
    localAvailability?: BaseAttachmentValue["localAvailability"]
  ): Promise<PutAttachmentResult> {
    return this.attachmentService.ingestCompletedImage(
      event,
      bytes,
      filename,
      localAvailability
    );
  }

  async ingestTranscriptAttachment(input: {
    chatId: string;
    incarnationId: string;
    assistantSeq: number;
    itemId: string;
    itemOrdinal: number;
    logicalKey: string;
    completedAt: number;
    sourceRevision: string;
    bytes: Buffer;
    filename: string;
  }): Promise<PutAttachmentResult> {
    return this.attachmentService.ingestTranscriptAttachment(input);
  }

  /* 以下四个是纯透传：返回类型即被委托者的契约，不在此处再抄一遍。 */
  readAttachmentThumbnail(input: ReadAttachmentThumbnailInput) {
    return this.attachmentService.readAttachmentThumbnail(input);
  }

  listGalleryEntries(input: ListGalleryEntriesInput) {
    return this.attachmentService.listGalleryEntries(input);
  }

  galleryThumbnail(sourceRef: GalleryMediaSourceRef, maxEdge: number) {
    return this.attachmentService.galleryThumbnail(sourceRef, maxEdge);
  }

  galleryMaterialize(
    sourceRef: GalleryMediaSourceRef,
    destinationChatId: string
  ) {
    return this.attachmentService.galleryMaterialize(
      sourceRef,
      destinationChatId
    );
  }

  async assertGalleryAttachmentAuthorized(
    sourceRef: Extract<GalleryMediaSourceRef, { kind: "attachment" }>,
    destinationChatId: string
  ) {
    return this.attachmentService.assertGalleryAttachmentAuthorized(
      sourceRef,
      destinationChatId
    );
  }

  exportForRenderer(ownerKey: string): Promise<BaseExportResult> {
    return this.io.exportCsvForRenderer(ownerKey);
  }

  exportJsonForRenderer(ownerKey: string): Promise<BaseExportResult> {
    return this.io.exportJsonForRenderer(ownerKey);
  }

  importJsonForRenderer(
    ownerKey: string,
    authority: BaseCommitAuthority,
    expectedRevision: number
  ) {
    return this.io.importJsonForRenderer(ownerKey, authority, expectedRevision);
  }

  importJson(
    ownerKey: string,
    file: string | BaseSnapshotFile,
    authority: BaseCommitAuthority,
    expectedRevision?: number
  ): Promise<BaseSnapshot> {
    return this.io.importJson(ownerKey, file, authority, expectedRevision);
  }

  async commitArtifactImport(identity: import("./base-store").BaseOwnerIdentity,
    parsed: { columns: BaseSnapshot["meta"]["columns"]; rows: BaseRow[] }, expectedRevision: number | null) {
    this.assertAdmission();
    const ownerKey = ownerKeyOf(identity.owner);
    if (expectedRevision === null) {
      const snapshot = await this.store.createArtifact(identity, parsed);
      this.events.changed(snapshot, { meta: snapshot.meta });
      return snapshot;
    }
    const current = await this.get(ownerKey);
    if (!current || current.meta.ownerInstanceId !== identity.ownerInstanceId) throw new Error("artifact-base-changed");
    const authority = await this.mutationAuthority.forRenderer({ ownerKey, operation: "json-import", expectedRevision });
    return this.importJson(ownerKey, baseSnapshotFile({ ...current, meta: { ...current.meta, columns: parsed.columns }, rows: parsed.rows }), authority, expectedRevision);
  }

  exportXlsxForRenderer(ownerKey: string): Promise<BaseExportResult> {
    return this.io.exportXlsxForRenderer(ownerKey);
  }

  importXlsxForRenderer(
    ownerKey: string,
    authority: BaseCommitAuthority,
    expectedRevision: number
  ) {
    return this.io.importXlsxForRenderer(ownerKey, authority, expectedRevision);
  }

  exportArtifact(ownerKey: string) {
    return this.io.exportCsvArtifact(ownerKey);
  }

  /**
   * chat 标题变更后的 best-effort 同步：只试一次 CAS。撞上并发写就放弃——
   * 下一次改名会再来一趟，重试只是把「名字晚一步」换成一段谁也不读的重试逻辑。
   */
  async renameForChat(
    record: Pick<ChatRecord, "id" | "incarnationId" | "title">
  ) {
    if (this.admission !== "accepting") return;
    const name = record.title?.trim();
    if (!name) return;
    const ownerKey = `chat:${record.id}`;
    const snapshot = this.store.get(ownerKey, record.incarnationId);
    if (!snapshot || snapshot.meta.name === name) return;
    try {
      await this.updateMeta({
        ownerKey,
        expectedRevision: snapshot.meta.revision,
        patch: { name },
        authority: this.commitAuthorities.issueSystem({
          ownerKey,
          ownerInstanceId: snapshot.meta.ownerInstanceId,
          allowedOperations: ["meta"],
          expectedRevision: snapshot.meta.revision,
        }),
      });
    } catch (cause) {
      if (!(cause instanceof BaseConflictError)) throw cause;
    }
  }

  async removeForChat(record: Pick<ChatRecord, "id" | "incarnationId">) {
    const ownerKey = `chat:${record.id}`;
    const removed = await this.store.remove(ownerKey, record.incarnationId);
    if (removed) {
      this.attachmentService.clearFamily(ownerKey, record.incarnationId);
      this.events.publish({
        type: "removed",
        ownerKey,
        ownerInstanceId: record.incarnationId,
      });
    }
  }

  async removeForProject(projectId: string) {
    const ownerKey = `project:${projectId}`;
    const current = this.store.peek(ownerKey);
    if (!current) return false;
    const ownerInstanceId = current.meta.ownerInstanceId;
    const removed = await this.store.remove(ownerKey, ownerInstanceId);
    if (removed) {
      this.attachmentService.clearFamily(ownerKey, ownerInstanceId);
      this.events.publish({
        type: "removed",
        ownerKey,
        ownerInstanceId,
      });
    }
    return removed;
  }

  hasProjectBase(projectId: string) {
    return Boolean(this.store.peek(`project:${projectId}`));
  }

  stopAdmission() {
    this.admission = "draining";
  }

  closeAdmission() {
    this.admission = "closed";
  }

  reopenAdmission() {
    this.admission = "accepting";
    this.store.reopen();
  }

  async closeAndFlush() {
    this.closeAdmission();
    await this.imageService.close();
    return this.store.closeAndFlush();
  }

  private assertAdmission() {
    if (this.admission !== "accepting") {
      throw codedError("base_closing", "应用正在退出，Base 写入已关闭");
    }
  }

  private async attachmentIdentity(chatId: string) {
    const chat = await this.ownerResolver.chat(chatId);
    const target = await this.ownerResolver.resolveTargetForSection(chatId);
    return {
      chatId: chat.id,
      incarnationId: chat.incarnationId,
      title: chat.title,
      owner: target.owner,
      ownerKey: ownerKeyOf(target.owner),
      ownerInstanceId: target.ownerInstanceId,
    };
  }

}
