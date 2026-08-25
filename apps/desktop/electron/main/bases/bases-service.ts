/**
 * [INPUT]: Depends on Electron BrowserWindow, shared owner-aware Bases/base.json schema, canonical Chat/Project, BaseStore/owner resolver, service line mutatIOn, core and IO front, promotion, attachment and system file dialog box
 * [OUTPUT]: Provides ownerKey CRUD/CAS/LWW, replay-aware App GUI line commands and attachments reading, Project Base probes, Section target analysis, promotion IPC, authority-bound attachments, events and CSV/JSON/XLSX commissioned
 * [POS]: The IPC/Common Business of the bases; Owner rules are resolved, format IO is service/base-io-facade, and promotion service is upgraded across Store
 */

import type { BrowserWindow } from "electron";
import {
  BASE_EVENT_BYTE_LIMIT,
  BASES_CHANNEL,
  ownerKeyOf,
  type BaseChangedEvent,
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
  type ReadAttachmentInput,
  type ReadAttachmentThumbnailInput,
} from "../../../shared/bases-ipc";
import { putAttachmentInputSchema } from "../../../shared/bases/gallery-attachments";
import type { BaseHistoryActor } from "../../../shared/bases/history-ledger-schema";
import type { BaseSnapshotFile } from "../../../shared/base-snapshot";
import type { AppBaseDataMigrationFile } from "../../../shared/app-data-migration";
import type { BaseGuiLiveBinding } from "../../../shared/apps-ipc";
import type { ChatRecord } from "../../../shared/chats-ipc";
import { errorMessage } from "../errors";
import { BaseStore, type BaseIdentity } from "./base-store";
import type { CompletedImageEventV1 } from "../gallery/turn-events-broker";
import type { GalleryMediaSourceRef } from "../../../shared/gallery-media-ipc";
import { BaseAttachmentService } from "./attachment-service";
import {
  BaseOwnerResolver,
  type BaseChatRef,
  type BaseLeaseIdentity,
} from "./base-owner-resolver";
import type { BasePromotionService } from "./base-promotion-service";
import { BaseIoFacade } from "./service/base-io-facade";
import {
  BaseCommitAuthorityRegistry,
  type BaseCommitAuthority,
  type BaseMutationOperation,
} from "./base-commit-authority";
import { BaseRowMutations } from "./service/base-row-mutations";
import { BaseAppGuiMutations } from "./service/base-app-gui-mutations";
import { registerBasesRendererIpc } from "./service/bases-renderer-ipc";

const clone = <T>(value: T): T => structuredClone(value);
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
  now?: () => number;
};

export class BaseConflictError extends Error {
  readonly status = 409;
}

export class BasesService {
  private window: BrowserWindow | null = null;
  private admission: "accepting" | "draining" | "closed" = "accepting";
  private readonly now: () => number;
  private readonly attachmentService: BaseAttachmentService;
  private readonly io: BaseIoFacade;
  private readonly rowMutations: BaseRowMutations;
  private readonly appGuiMutations: BaseAppGuiMutations;
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
        if (!snapshot) throw httpError(404, "Attachment source 不存在");
        const principal = await this.ownerResolver.resolvePrincipal(
          snapshot.meta,
          { chatId: chat.id, incarnationId: chat.incarnationId }
        );
        if (!principal) throw httpError(403, "目标 chat 无权读取 source Base");
      },
      assertAdmission: () => this.assertAdmission(),
      emitChange: (snapshot, delta) => this.emitChange(snapshot, delta),
      now: this.now,
      warn: (message) => this.store.pushWarning(message),
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
      emitChange: (snapshot, delta) => this.emitChange(snapshot, delta),
    });
    this.rowMutations = new BaseRowMutations(store, {
      assertAdmission: () => this.assertAdmission(),
      mutationIdentity: (ownerKey, authority, operation) =>
        this.mutationIdentity(ownerKey, authority, operation),
      mutationScope: (ownerKey, authority, operation, appFence) =>
        this.mutationScope(ownerKey, authority, operation, appFence),
      emitChange: (snapshot, delta) => this.emitChange(snapshot, delta),
      conflict: (message) => new BaseConflictError(message),
    });
    this.appGuiMutations = new BaseAppGuiMutations(
      this.rowMutations,
      this.attachmentService,
      this.commitAuthorities,
      { requireOwner: (ownerKey) => this.requireOwner(ownerKey) }
    );
  }

  configurePromotion(service: BasePromotionService) {
    if (this.promotion) throw new Error("Base promotion service 已配置");
    this.promotion = service;
  }

  configureAppSurfaceValidator(validator: NonNullable<BasesService["appSurfaceValidator"]>) {
    if (this.appSurfaceValidator) throw new Error("Base App surface validator 已配置");
    this.appSurfaceValidator = validator;
  }

  /** media-host 等消费者的告警通道；不暴露 store 内部结构。 */
  pushWarning(message: string) {
    this.store.pushWarning(message);
  }

  publishEvent(event: BasesEvent) {
    this.emit(event);
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    registerBasesRendererIpc(window, rendererUrl, this, {
      authorize: (input) => this.authorizeRendererMutation(input),
      consume: (leaseId) => this.commitAuthorities.consumeRenderer(leaseId),
      putAttachment: (input) => this.putAttachmentFromRenderer(input),
      promote: (input) => {
        if (!this.promotion) throw new Error("Base promotion 尚未初始化");
        return this.promotion.promote(input);
      },
      closed: () => {
        if (this.window === window) this.window = null;
      },
    });
  }

  async get(ownerKey: string): Promise<BaseSnapshot | null> {
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    return this.store.get(ownerKey, identity.ownerInstanceId || undefined);
  }

  rowHistory(ownerKey: string, rowId: string) {
    return this.io.rowHistory(ownerKey, rowId);
  }

  async ensure(ownerKey: string): Promise<BaseSnapshot> {
    this.assertAdmission();
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    if (!identity.ownerInstanceId) {
      throw httpError(404, "Project Base 尚未创建");
    }
    return this.store.ensure(identity);
  }

  async discardCorrupt(ownerKey: string): Promise<BaseSnapshot> {
    this.assertAdmission();
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    const snapshot = await this.store.discardCorrupt(identity);
    this.emitChange(snapshot, { meta: snapshot.meta, upserts: [] });
    return snapshot;
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
    if (!ensure) throw httpError(404, "Base 尚未创建");
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
    const located = this.store.locate(ownerKey, identity.ownerInstanceId);
    return { ownerKey, ...located };
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
    if (!ensure) throw httpError(404, "App Base 尚未创建");
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
    if (!snapshot) throw httpError(404, "Base 尚未创建");
    const principal = await this.ownerResolver.assertCanMutate(
      snapshot.meta,
      input.lease,
      input.appId
    );
    if (
      principal.kind === "app-attachment" &&
      (principal.level !== "row-write" || input.operation === "meta")
    ) {
      throw httpError(403, "App attachment 只允许 ordinary Base 行级 mutation");
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

  assertRendererOwnerKey(ownerKey: string) {
    return ownerKey;
  }

  navigationBases<T extends { ownerKey: string }>(bases: T[]) {
    return bases;
  }

  private async authorizeRendererMutation(input: {
    ownerKey: string;
    operation: BaseMutationOperation;
    expectedRevision: number | null;
    surfaceLeaseId?: string;
  }) {
    const identity = await this.ownerResolver.identityForOwnerKey(input.ownerKey);
    const snapshot = this.store.get(
      input.ownerKey,
      identity.ownerInstanceId || undefined
    );
    if (!snapshot) throw httpError(404, "Base 尚未创建");
    if (input.surfaceLeaseId) {
      if (!this.appSurfaceValidator) {
        throw httpError(503, "App surface authority 尚未初始化");
      }
      await this.appSurfaceValidator.validateMutation({
        surfaceLeaseId: input.surfaceLeaseId,
        ownerKey: input.ownerKey,
        operation: input.operation,
      });
    }
    if (
      input.expectedRevision !== null &&
      input.expectedRevision !== snapshot.meta.revision
    ) {
      throw new BaseConflictError(
        `Base revision 已变化：期望 ${input.expectedRevision}，实际 ${snapshot.meta.revision}`
      );
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
    const { authorityLeaseId, ...upload } = input;
    const authority = this.commitAuthorities.consumeRenderer(authorityLeaseId);
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

  /* 以下五个是纯透传：返回类型即被委托者的契约，不在此处再抄一遍。 */
  readAttachment(input: ReadAttachmentInput) {
    return this.attachmentService.readAttachment(input);
  }

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

  /** chat 标题变更后的 best-effort 同步：Base 名跟随 chat 名，冲突重试一次 */
  async renameForChat(
    record: Pick<ChatRecord, "id" | "incarnationId" | "title">
  ) {
    if (this.admission !== "accepting") return;
    const name = record.title?.trim();
    if (!name) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
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
        return;
      } catch (cause) {
        if (!(cause instanceof BaseConflictError) || attempt > 0) throw cause;
      }
    }
  }

  async removeForChat(record: Pick<ChatRecord, "id" | "incarnationId">) {
    const ownerKey = `chat:${record.id}`;
    const removed = await this.store.remove(ownerKey, record.incarnationId);
    if (removed) {
      this.attachmentService.clearFamily(ownerKey, record.incarnationId);
      this.emit({
        type: "removed",
        ownerKey,
        ownerInstanceId: record.incarnationId,
      });
    }
  }

  async removeForProject(projectId: string) {
    const ownerKey = `project:${projectId}`;
    // 级联删除必须能清理损坏墓碑：locate 三态定位，绝不走会对 corrupt 抛错的 get
    const located = this.store.locate(ownerKey);
    if (located.status === "absent") return false;
    const removed = await this.store.remove(
      ownerKey,
      located.ownerInstanceId || undefined
    );
    if (removed) {
      this.attachmentService.clearFamily(ownerKey, located.ownerInstanceId);
      this.emit({
        type: "removed",
        ownerKey,
        ownerInstanceId: located.ownerInstanceId,
      });
    }
    return removed;
  }

  hasProjectBase(projectId: string) {
    return this.store.locate(`project:${projectId}`).status !== "absent";
  }

  stopAdmission() {
    this.admission = "draining";
  }

  closeAdmission() {
    this.admission = "closed";
    this.commitAuthorities.revokeAll();
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

  private async identity(chatId: string): Promise<BaseIdentity> {
    const chat = await this.ownerResolver.chat(chatId);
    return {
      chatId: chat.id,
      incarnationId: chat.incarnationId,
      title: chat.title,
    };
  }

  /** owner 解析 + 「Base 必须已存在」的唯一一份规则；三个写入前置都从这里取事实。 */
  private async ownerSnapshot(ownerKey: string) {
    const identity = await this.ownerResolver.identityForOwnerKey(ownerKey);
    const snapshot = this.store.get(
      ownerKey,
      identity.ownerInstanceId || undefined
    );
    if (!snapshot) throw httpError(404, "Base 尚未创建");
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
    const chat = await this.identity(chatId);
    const target = await this.ownerResolver.resolveTargetForSection(chatId);
    return {
      ...chat,
      owner: target.owner,
      ownerKey: ownerKeyOf(target.owner),
      ownerInstanceId: target.ownerInstanceId,
    };
  }

  private emitChange(
    snapshot: BaseSnapshot,
    delta: Pick<BaseChangedEvent, "meta" | "upserts" | "removedRowIds">
  ) {
    const full: BaseChangedEvent = {
      type: "base-changed",
      ownerKey: ownerKeyOf(snapshot.meta.owner),
      ownerInstanceId: snapshot.meta.ownerInstanceId,
      revision: snapshot.meta.revision,
      ...clone(delta),
    };
    const event =
      Buffer.byteLength(JSON.stringify(full), "utf8") <= BASE_EVENT_BYTE_LIMIT
        ? full
        : {
            type: "base-changed" as const,
            ownerKey: full.ownerKey,
            ownerInstanceId: full.ownerInstanceId,
            revision: full.revision,
          };
    this.emit(event);
  }

  private emit(event: BasesEvent) {
    this.options.onEvent?.(clone(event));
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    try {
      window.webContents.send(BASES_CHANNEL.event, event);
    } catch (cause) {
      console.warn("[bases] event publish failed", cause);
    }
  }
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export function basesErrorMessage(cause: unknown) {
  return errorMessage(cause);
}
