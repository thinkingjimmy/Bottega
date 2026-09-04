/**
 * [INPUT]: Depends on Electron BrowserWindow, owner-aware Bases schemas, canonical Chat/Project records, BaseStore/owner resolution, row mutation, IO, promotion, attachment, and file-dialog ports, plus the shared statusError constructor from main/errors
 * [OUTPUT]: Provides ownerKey CRUD/CAS/LWW, pre-copy Query snapshot descriptors, replay-aware App GUI row commands, exact App-renderer owner fences, Project probes, Section resolution, retained-data navigation promotion, attachment events, and CSV/JSON/XLSX operations
 * [POS]: Bases application service; owner and trusted App-renderer boundaries are resolved here while format IO and cross-store promotion remain delegated
 */

import type { BrowserWindow } from "electron";
import {
  ownerKeyOf,
  type BaseExportResult,
  type BaseMetaPatch,
  type BaseRow,
  type BaseRowPatch,
  type BasesEvent,
  type BaseSnapshot,
  type ListGalleryEntriesInput,
  type PutAttachmentInput,
  type PutAttachmentRequest,
  type PutAttachmentResult,
  type ReadAttachmentThumbnailInput,
} from "../../../shared/bases-ipc";
import { putAttachmentInputSchema } from "../../../shared/bases/gallery-attachments";
import type { BaseHistoryActor } from "../../../shared/bases/history-ledger-schema";
import type { BaseSnapshotFile } from "../../../shared/base-snapshot";
import type { AppBaseDataMigrationFile } from "../../../shared/app-data-migration";
import type { BaseGuiLiveBinding } from "../../../shared/apps-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
import { BaseConflictError, BaseStore } from "./base-store";
import type { CompletedImageEventV1 } from "../gallery/turn-events-broker";
import type { GalleryMediaSourceRef } from "../../../shared/gallery-media-ipc";
import { BaseAttachmentService } from "./attachment/attachment-service";
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
import { statusError } from "../errors";

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
export class BasesService {
  private admission: "accepting" | "draining" | "closed" = "accepting";
  private readonly now: () => number;
  private readonly attachmentService: BaseAttachmentService;
  private readonly io: BaseIoFacade;
  private readonly rowMutations: BaseRowMutations;
  private readonly appGuiMutations: BaseAppGuiMutations;
  private readonly retainedNavigation: RetainedBaseNavigation;
  private readonly events: BaseEventPublisher;
  private readonly commitAuthorities = new BaseCommitAuthorityRegistry();
  private appSurfaceValidator: {
    validateMutation(input: {
      surfaceLeaseId: string;
      ownerKey: string;
      operation: BaseMutationOperation;
    }): Promise<unknown>;
  } | null = null;
  readonly ownerResolver: BaseOwnerResolver;
  private promotion: BasePromotionService | null = null;
  constructor(
    readonly store: BaseStore,
    private readonly options: BasesServiceOptions
  ) {
    this.now = options.now ?? Date.now;
    this.events = new BaseEventPublisher(options.onEvent);
    this.ownerResolver = new BaseOwnerResolver(store, {
      getChat: options.getChat,
      getProject: (projectId) => options.getProject?.(projectId),
    });
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
      requireOwner: (ownerKey) => this.requireOwner(ownerKey),
      mutationIdentity: (ownerKey, authority, operation) =>
        this.mutationIdentity(ownerKey, authority, operation),
      assertAdmission: () => this.assertAdmission(),
      emitChange: (snapshot, delta) => this.events.changed(snapshot, delta),
    });
    this.rowMutations = new BaseRowMutations(store, {
      assertAdmission: () => this.assertAdmission(),
      mutationIdentity: (ownerKey, authority, operation) =>
        this.mutationIdentity(ownerKey, authority, operation),
      mutationScope: (ownerKey, authority, operation, appFence) =>
        this.mutationScope(ownerKey, authority, operation, appFence),
      emitChange: (snapshot, delta) => this.events.changed(snapshot, delta),
      conflict: (message) => new BaseConflictError(message),
    });
    this.appGuiMutations = new BaseAppGuiMutations(
      this.rowMutations,
      this.attachmentService,
      this.commitAuthorities,
      { requireOwner: (ownerKey) => this.requireOwner(ownerKey) }
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

  configureAppSurfaceValidator(validator: NonNullable<BasesService["appSurfaceValidator"]>) {
    if (this.appSurfaceValidator) throw new Error("Base App surface validator 已配置");
    this.appSurfaceValidator = validator;
  }

  publishEvent(event: BasesEvent) {
    this.events.publish(event);
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.events.bind(window);
    registerBasesRendererIpc(window, rendererUrl, this, {
      rendererAuthority: (input) => this.rendererAuthority(input),
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
    return this.store.get(ownerKey, identity.ownerInstanceId || undefined);
  }

  async querySnapshot(ownerKey: string) {
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    const descriptor = await this.store.describeQuerySnapshot(
      ownerKey,
      identity.ownerInstanceId || undefined
    );
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
      throw statusError(404, "Project Base 尚未创建");
    }
    return this.store.ensure(identity);
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
    if (!ensure) throw statusError(404, "Base 尚未创建");
    this.assertAdmission();
    return this.store.ensure(identity);
  }

  /** 跨 Section 读路径：验证 canonical chat/incarnation，但绝不隐式创建 Base。 */
  async snapshotForRead(chatId: string) {
    const identity = await this.ownerResolver.resolveTargetForSection(chatId);
    return this.requireOwner(ownerKeyOf(identity.owner));
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
    if (!ensure) throw statusError(404, "App Base 尚未创建");
    this.assertAdmission();
    return this.store.ensure(identity);
  }

  async issueToolMutationAuthority(input: {
    ownerKey: string;
    lease: BaseLeaseIdentity;
    operation: BaseMutationOperation;
    appId?: string;
  }) {
    const identity = await this.ownerResolver.identityForOwnerKey(input.ownerKey);
    const snapshot = this.store.get(
      input.ownerKey,
      identity.ownerInstanceId || undefined
    );
    if (!snapshot) throw statusError(404, "Base 尚未创建");
    const principal = await this.ownerResolver.assertCanMutate(
      snapshot.meta,
      input.lease,
      input.appId
    );
    if (
      principal.kind === "app-attachment" &&
      (principal.level !== "row-write" || input.operation === "meta")
    ) {
      throw statusError(403, "App attachment 只允许 ordinary Base 行级 mutation");
    }
    return this.commitAuthorities.issueAgent({
      ownerKey: input.ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      allowedOperations: [input.operation],
      expectedRevision: snapshot.meta.revision,
      ...(principal.kind === "app-attachment"
        ? {
            appFence: {
              appId: principal.appId,
              generationId: principal.snapshot.appGenerationId,
              contentDigest: principal.snapshot.appContentDigest,
              lifecycleRevision: principal.snapshot.appLifecycleRevision,
            },
          }
        : {}),
    });
  }

  async issueSystemMutationAuthority(
    ownerKey: string,
    operation: BaseMutationOperation
  ) {
    const snapshot = await this.requireOwner(ownerKey);
    return this.commitAuthorities.issueSystem({
      ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      allowedOperations: [operation],
      expectedRevision: snapshot.meta.revision,
    });
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

  /**
   * renderer 的写入资格：owner 快照 + App surface 校验，没有第二次 IPC。
   * revision 不在这里预判——owner queue 里的内核 CAS 是唯一裁判，
   * 这里再判一次只会制造一个「判过又反悔」的 TOCTOU 窗口。
   */
  private async rendererAuthority(input: {
    ownerKey: string;
    operation: BaseMutationOperation;
    expectedRevision: number | null;
    surfaceLeaseId?: string;
  }) {
    const { snapshot } = await this.ownerSnapshot(input.ownerKey);
    if (input.surfaceLeaseId) {
      if (!this.appSurfaceValidator) {
        throw statusError(503, "App surface authority 尚未初始化");
      }
      await this.appSurfaceValidator.validateMutation({
        surfaceLeaseId: input.surfaceLeaseId,
        ownerKey: input.ownerKey,
        operation: input.operation,
      });
    }
    return this.commitAuthorities.issueRenderer({
      ownerKey: input.ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      allowedOperations: [input.operation],
      expectedRevision: input.expectedRevision,
    });
  }

  /** App 包声明、平台执行；一个 owner queue、一个 revision、一次事件。 */
  async applyAppDataMigration(
    ownerKey: string,
    file: AppBaseDataMigrationFile
  ) {
    return this.rowMutations.applyAppDataMigration(ownerKey, file);
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
    const authority = await this.rendererAuthority({
      ownerKey: upload.ownerKey,
      operation: "attachment-put",
      expectedRevision: upload.expectedRevision ?? null,
      ...(surfaceLeaseId ? { surfaceLeaseId } : {}),
    });
    const identity = await this.mutationIdentity(
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
    filename = `${event.sourceRef.itemId}.png`
  ): Promise<PutAttachmentResult> {
    return this.attachmentService.ingestCompletedImage(
      event,
      bytes,
      filename
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

  closeAndFlush() {
    this.closeAdmission();
    return this.store.closeAndFlush();
  }

  private assertAdmission() {
    if (this.admission !== "accepting") {
      throw new Error("应用正在退出，Base 写入已关闭");
    }
  }

  /** owner 解析 + 「Base 必须已存在」的唯一一份规则；三个写入前置都从这里取事实。 */
  private async ownerSnapshot(ownerKey: string) {
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    const snapshot = this.store.get(
      ownerKey,
      identity.ownerInstanceId || undefined
    );
    if (!snapshot) throw statusError(404, "Base 尚未创建");
    return { identity, snapshot };
  }

  private async requireOwner(ownerKey: string) {
    return (await this.ownerSnapshot(ownerKey)).snapshot;
  }

  private async mutationIdentity(
    ownerKey: string,
    authority: BaseCommitAuthority,
    operation: BaseMutationOperation
  ) {
    const { identity, snapshot } = await this.ownerSnapshot(ownerKey);
    this.commitAuthorities.assert(authority, {
      ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      operation,
      revision: snapshot.meta.revision,
    });
    return identity;
  }

  private async mutationScope(
    ownerKey: string,
    authority: BaseCommitAuthority,
    operation: BaseMutationOperation,
    appFence: NonNullable<BaseCommitAuthority["appFence"]>
  ) {
    const { identity, snapshot } = await this.ownerSnapshot(ownerKey);
    this.commitAuthorities.assertScope(authority, {
      ownerKey,
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      operation,
      appFence,
    });
    return identity;
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
