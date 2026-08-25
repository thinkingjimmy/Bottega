/**
 * [INPUT]: Depends on shared owner-aware Bases/Gallery schema, commit-kernel, attachments, startup recovery and SerialQueue; Initiate receiving canonical chat/project identity
 * [OUTPUT]: Provides owner key indexed BaseStore, rows+gallery+history, runtime generation submissions, one-time start of migration events, damage/migration blocks reconstruction and promotion
 * [POS]: The bases are the source of the runtime disk truth of the modules; Starting the 3D box, store/startup-migration, v2 meta is the only release record for rows/gallery/history
 */
import { join } from "node:path";
import {
  BASE_OWNER_KEY_PATTERN,
  ownerKeyOf,
  type BaseMigrationEvent,
  type BaseMeta,
  type BasePinnedSummary,
  type BaseSnapshot,
} from "../../../shared/bases-ipc";
import {
  baseMetaSchema,
  baseRowSchema,
} from "../../../shared/bases-schema";
import type { BaseGalleryLedger } from "../../../shared/bases/gallery-attachments";
import type {
  BaseHistoryActor,
  BaseHistoryEntry,
  BaseHistoryLedger,
} from "../../../shared/bases/history-ledger-schema";
import { errorMessage } from "../errors";
import { SerialQueue } from "../persistence/serial-queue";
import { BaseAttachmentStore } from "./store/attachments";
import {
  BaseAmbiguousCommitError,
  BaseNotPublishedCommitError,
  publishMeta,
} from "./store/commit-kernel";
import { BaseStoreFiles, ownerFileStem } from "./store/base-files";
import {
  collectRowAttachmentBlobIds,
  deriveGalleryRemovals,
  emptyGalleryLedger,
  parseGalleryLedger,
} from "./store/gallery-ledger";
import {
  appendHistoryEntry,
  emptyHistoryLedger,
  historyForRow,
} from "./store/history-ledger";
import { prepareProjectBase } from "./base-promotion";
import {
  initializeBaseStoreStartup,
  type BaseStartupBlocked,
} from "./store/startup-migration";
import {
  BaseCorruptError,
  BaseIncarnationError,
  BaseNotFoundError,
  BaseStoreConflictError,
  baseNavigationSummary,
  chatOwnerIdentity,
  galleryOwnerId,
  projectOwnerIdentity,
  validateStoredBase,
  type BaseIdentity,
  type BaseOwnerIdentity,
  type BaseStoreDependencies,
  type BaseStoreMutation,
  type CorruptTombstone,
  type ReadonlyBaseSnapshot,
  type StoredBase,
} from "./base-store-model";
export {
  BaseCorruptError,
  BaseIncarnationError,
  BaseNotFoundError,
  BaseStoreConflictError,
  chatOwnerIdentity,
  projectOwnerIdentity,
};
export type {
  BaseIdentity,
  BaseOwnerIdentity,
  BaseStoreDependencies,
  BaseStoreMutation,
  ReadonlyBaseSnapshot,
};
const clone = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
export class BaseStore {
  readonly basesRoot: string;
  readonly root: string;
  readonly exportsRoot: string;
  readonly attachments: BaseAttachmentStore;
  private readonly queue = new SerialQueue();
  private readonly states = new Map<string, StoredBase>();
  private readonly corrupt = new Map<string, CorruptTombstone>();
  private readonly warnings: string[] = [];
  private readonly migrationEvents: BaseMigrationEvent[] = [];
  private readonly frozen = new Map<string, BaseAmbiguousCommitError>();
  private readonly startupBlocked = new Map<string, BaseStartupBlocked>();
  private readonly files: BaseStoreFiles;
  private readonly now: () => number;
  constructor(
    userData: string,
    private readonly dependencies: BaseStoreDependencies = {}
  ) {
    /* 目录布局是既有数据的既成事实：bases/ 下 v2 与 exports 的路径字节不可动。 */
    this.basesRoot = join(userData, "bases");
    this.root = join(this.basesRoot, "v2");
    this.exportsRoot = join(this.basesRoot, "exports");
    this.attachments = new BaseAttachmentStore(this.root);
    this.now = dependencies.now ?? Date.now;
    this.files = new BaseStoreFiles(this.root, {
      readText: dependencies.readText,
      atomicWrite: dependencies.atomicWrite,
      corrupt: (message) => new BaseCorruptError(message),
      warn: (message) => this.warn(message),
    });
  }
  initialize(
    chats: ReadonlyMap<string, BaseIdentity>,
    projectIds: ReadonlySet<string> = new Set()
  ) {
    return this.queue.enqueue(() =>
      initializeBaseStoreStartup({
        root: this.root,
        exportsRoot: this.exportsRoot,
        files: this.files,
        attachments: this.attachments,
        states: this.states,
        corrupt: this.corrupt,
        frozen: this.frozen,
        startupBlocked: this.startupBlocked,
        warnings: this.warnings,
        migrationEvents: this.migrationEvents,
        chats,
        projectIds,
        now: this.now,
      })
    );
  }
  getWarning() {
    return this.warnings.join("\n") || undefined;
  }

  drainMigrationEvents() {
    return this.migrationEvents.splice(0).map(clone);
  }

  pushWarning(message: string) {
    this.warn(message);
  }
  locate(ownerKey: string, fallbackInstanceId = "") {
    this.assertOwnerKey(ownerKey);
    const state = this.states.get(ownerKey);
    if (state) {
      return {
        status: "healthy" as const,
        ownerInstanceId: state.meta.ownerInstanceId,
      };
    }
    const tombstone = this.corrupt.get(ownerKey);
    if (tombstone) {
      return {
        status: "corrupt" as const,
        ownerInstanceId:
          tombstone.ownerInstanceId ?? fallbackInstanceId,
      };
    }
    const blocked = this.startupBlocked.get(ownerKey);
    if (blocked) {
      return {
        status: "corrupt" as const,
        ownerInstanceId: blocked.ownerInstanceId,
      };
    }
    return {
      status: "absent" as const,
      ownerInstanceId: fallbackInstanceId,
    };
  }
  get(ownerKey: string, ownerInstanceId?: string): BaseSnapshot | null {
    this.assertNotCorrupt(ownerKey, ownerInstanceId);
    const state = this.states.get(ownerKey);
    if (!state) return null;
    if (ownerInstanceId) this.assertInstance(state.meta, ownerInstanceId);
    return this.snapshot(state);
  }
  peek(ownerKey: string, ownerInstanceId?: string): ReadonlyBaseSnapshot | null {
    this.assertNotCorrupt(ownerKey, ownerInstanceId);
    const state = this.states.get(ownerKey);
    if (!state) return null;
    if (ownerInstanceId) this.assertInstance(state.meta, ownerInstanceId);
    return state;
  }
  /** 全量只读枚举（search 扫描源）；提交是整对象替换，引用无需克隆即版本一致。 */
  listAll(): Array<{ ownerKey: string; snapshot: ReadonlyBaseSnapshot }> {
    return [...this.states.entries()].map(([ownerKey, snapshot]) => ({
      ownerKey,
      snapshot,
    }));
  }
  baseSummaries() {
    return new Map(
      [...this.states.entries()].map(([ownerKey, { meta, rows }]) => [
        ownerKey,
        {
          owner: clone(meta.owner),
          ownerInstanceId: meta.ownerInstanceId,
          rowCount: rows.length,
        },
      ])
    );
  }
  listPinned(): BasePinnedSummary[] {
    return [...this.states.values()]
      .filter(({ meta }) => meta.pinned)
      .sort(
        (left, right) =>
          left.meta.name.localeCompare(right.meta.name) ||
          ownerKeyOf(left.meta.owner).localeCompare(ownerKeyOf(right.meta.owner))
      )
      .map(({ meta }) => baseNavigationSummary(meta));
  }
  listProjectBases(): BasePinnedSummary[] {
    return [...this.states.values()]
      .filter(({ meta }) => meta.owner.kind === "project")
      .sort((left, right) => left.meta.name.localeCompare(right.meta.name))
      .map(({ meta }) => baseNavigationSummary(meta));
  }
  ensure(identity: BaseOwnerIdentity | BaseIdentity): Promise<BaseSnapshot> {
    const ownerIdentity =
      "owner" in identity ? identity : chatOwnerIdentity(identity);
    return this.queue.enqueue(() => this.ensureLocked(ownerIdentity));
  }
  transact(
    ownerKey: string,
    ownerInstanceId: string,
    mutate: (current: BaseSnapshot) => BaseStoreMutation | null
  ): Promise<BaseSnapshot> {
    return this.queue.enqueue(async () => {
      const current = this.snapshot(
        this.requireState(ownerKey, ownerInstanceId)
      );
      const mutation = mutate(current);
      return mutation
        ? this.commitLocked(ownerKey, ownerInstanceId, mutation)
        : current;
    });
  }
  transactGallery<T>(
    ownerKey: string,
    ownerInstanceId: string,
    mutate: (current: {
      snapshot: BaseSnapshot;
      gallery: BaseGalleryLedger;
    }) => Promise<{ mutation: BaseStoreMutation | null; result: T } | null>
  ): Promise<{ snapshot: BaseSnapshot; result: T | null }> {
    return this.queue.enqueue(async () => {
      const state = this.requireState(ownerKey, ownerInstanceId);
      const current = {
        snapshot: this.snapshot(state),
        gallery: clone(state.gallery),
      };
      const changed = await mutate(current);
      if (!changed) return { snapshot: current.snapshot, result: null };
      if (!changed.mutation) {
        return { snapshot: current.snapshot, result: changed.result };
      }
      const snapshot = await this.commitLocked(
        ownerKey,
        ownerInstanceId,
        changed.mutation
      );
      return { snapshot, result: changed.result };
    });
  }
  gallery(ownerKey: string, ownerInstanceId: string) {
    return clone(this.requireState(ownerKey, ownerInstanceId).gallery);
  }
  rowHistory(ownerKey: string, ownerInstanceId: string, rowId: string) {
    return clone(
      historyForRow(
        this.requireState(ownerKey, ownerInstanceId).history,
        rowId
      )
    );
  }
  discardCorrupt(identity: BaseOwnerIdentity): Promise<BaseSnapshot> {
    return this.queue.enqueue(async () => {
      const ownerKey = ownerKeyOf(identity.owner);
      const tombstone = this.corrupt.get(ownerKey);
      const blocked = this.startupBlocked.get(ownerKey);
      if (!tombstone && !blocked) {
        throw new BaseStoreConflictError("Base 没有待丢弃的损坏数据");
      }
      const blockedInstanceId =
        tombstone?.ownerInstanceId ?? blocked?.ownerInstanceId;
      if (
        blockedInstanceId &&
        blockedInstanceId !== identity.ownerInstanceId
      ) {
        throw new BaseIncarnationError("损坏 Base 生命周期与 owner 不一致");
      }
      const rebuild =
        identity.owner.kind === "project"
          ? projectOwnerIdentity(identity.owner.projectId, identity.title)
          : identity;
      await this.files.removeFamilyFiles(ownerKey);
      await this.attachments.releaseFamily(
        ownerFileStem(ownerKey),
        identity.ownerInstanceId,
        "deleted-proven"
      );
      this.corrupt.delete(ownerKey);
      this.startupBlocked.delete(ownerKey);
      return this.ensureLocked(rebuild);
    });
  }
  remove(ownerKey: string, ownerInstanceId?: string): Promise<boolean> {
    return this.queue.enqueue(() =>
      this.removeLocked(ownerKey, ownerInstanceId)
    );
  }
  /**
   * Promotion 的本地提交点：先完整复制 attachment/rows/gallery，再发布 project meta。
   * lifecycle intent 的 phase 推进与终态不在叶子 queue 内执行。
   */
  preparePromotion(
    chatId: string,
    projectId: string,
    intentId: string
  ): Promise<BaseSnapshot> {
    return this.queue.enqueue(async () => {
      const fromKey = `chat:${chatId}`;
      const toKey = `project:${projectId}`;
      const existing = this.states.get(toKey);
      if (existing) {
        if (existing.meta.ownerInstanceId !== intentId) {
          throw new BaseStoreConflictError("Project 已有 Base");
        }
        return this.snapshot(existing);
      }
      const source = this.requireState(
        fromKey,
        this.states.get(fromKey)?.meta.ownerInstanceId ?? ""
      );
      const state = await prepareProjectBase({
        source,
        fromKey,
        toKey,
        projectId,
        intentId,
        files: this.files,
        attachments: this.attachments,
        publishMeta: (ownerKey, content) =>
          this.publishSerializedNewMeta(ownerKey, content),
      });
      this.states.set(toKey, state);
      return this.snapshot(state);
    });
  }
  finalizePromotion(
    chatId: string,
    projectId: string,
    intentId: string
  ): Promise<BaseSnapshot> {
    return this.queue.enqueue(async () => {
      const fromKey = `chat:${chatId}`;
      const toKey = `project:${projectId}`;
      const target = this.requireState(toKey, intentId);
      const source = this.states.get(fromKey);
      await this.removeLocked(fromKey, source?.meta.ownerInstanceId);
      return this.snapshot(target);
    });
  }

  rollbackPromotion(projectId: string, intentId: string) {
    return this.queue.enqueue(async () => {
      const ownerKey = `project:${projectId}`;
      const tombstone = this.corrupt.get(ownerKey);
      const blocked = this.startupBlocked.get(ownerKey);
      if (
        (tombstone?.ownerInstanceId ?? blocked?.ownerInstanceId) &&
        (tombstone?.ownerInstanceId ?? blocked?.ownerInstanceId) !== intentId
      ) {
        throw new BaseIncarnationError("待回滚 Project Base 生命周期已变化");
      }
      const state = this.states.get(ownerKey);
      if (state && state.meta.ownerInstanceId !== intentId) {
        throw new BaseIncarnationError("待回滚 Project Base 生命周期已变化");
      }
      await this.files.removeFamilyFiles(ownerKey);
      await this.attachments.releaseFamily(
        ownerFileStem(ownerKey),
        intentId,
        "deleted-proven"
      );
      this.states.delete(ownerKey);
      this.corrupt.delete(ownerKey);
      this.startupBlocked.delete(ownerKey);
      this.frozen.delete(ownerKey);
      return Boolean(state || tombstone || blocked);
    });
  }

  closeAndFlush() {
    this.queue.close();
    return this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private snapshot(state: StoredBase): BaseSnapshot {
    return {
      meta: clone(state.meta),
      rows: clone(state.rows),
      ...(this.getWarning() ? { warning: this.getWarning() } : {}),
    };
  }

  private requireState(ownerKey: string, ownerInstanceId: string) {
    this.assertNotCorrupt(ownerKey, ownerInstanceId);
    const frozen = this.frozen.get(ownerKey);
    if (frozen) throw frozen;
    const state = this.states.get(ownerKey);
    if (!state) throw new BaseNotFoundError("Base 不存在");
    this.assertInstance(state.meta, ownerInstanceId);
    return state;
  }

  private assertNotCorrupt(ownerKey: string, ownerInstanceId?: string) {
    this.assertOwnerKey(ownerKey);
    const tombstone = this.corrupt.get(ownerKey);
    if (
      tombstone &&
      !(
        ownerInstanceId &&
        tombstone.ownerInstanceId &&
        tombstone.ownerInstanceId !== ownerInstanceId
      )
    ) {
      throw new BaseCorruptError(
        `BASE_CORRUPT: Base ${ownerKey} 已因损坏隔离；恢复备份或确认丢弃后才能继续`
      );
    }
    const blocked = this.startupBlocked.get(ownerKey);
    if (blocked) throw blocked.error;
  }

  private assertInstance(meta: BaseMeta, ownerInstanceId: string) {
    if (meta.ownerInstanceId !== ownerInstanceId) {
      throw new BaseIncarnationError("Base owner 生命周期已变化");
    }
  }

  private assertOwnerKey(ownerKey: string) {
    if (!BASE_OWNER_KEY_PATTERN.test(ownerKey)) {
      throw new Error("Base ownerKey 格式无效");
    }
  }

  private async ensureLocked(identity: BaseOwnerIdentity) {
    const ownerKey = ownerKeyOf(identity.owner);
    this.assertOwnerKey(ownerKey);
    this.assertNotCorrupt(ownerKey, identity.ownerInstanceId);
    const frozen = this.frozen.get(ownerKey);
    if (frozen) throw frozen;
    const existing = this.states.get(ownerKey);
    if (existing) {
      this.assertInstance(existing.meta, identity.ownerInstanceId);
      return this.snapshot(existing);
    }
    const meta = baseMetaSchema.parse({
      owner: identity.owner,
      ownerInstanceId: identity.ownerInstanceId,
      name: identity.title?.trim() || "Untitled Base",
      pinned: false,
      columns: [],
      views: [
        {
          id: "table",
          name: "Table",
          order: 0,
          config: { type: "table" },
        },
      ],
      activeViewId: "table",
      revision: 0,
      rowsGeneration: 0,
      galleryGeneration: 0,
      historyGeneration: 0,
    });
    const rows: import("../../../shared/bases-ipc").BaseRow[] = [];
    const gallery = emptyGalleryLedger(
      galleryOwnerId(meta),
      meta.ownerInstanceId
    );
    const history = emptyHistoryLedger();
    await this.files.atomicWrite(
      this.files.rowsPath(ownerKey, 0),
      this.files.serializeRows(rows)
    );
    await this.files.atomicWrite(
      this.files.galleryPath(ownerKey, 0),
      this.files.serializeGallery(gallery)
    );
    await this.files.atomicWrite(
      this.files.historyPath(ownerKey, 0),
      this.files.serializeHistory(history)
    );
    await this.publishNewMeta(ownerKey, meta);
    const state = { meta, rows, gallery, history };
    this.states.set(ownerKey, state);
    return this.snapshot(state);
  }

  private async publishNewMeta(ownerKey: string, meta: BaseMeta) {
    return this.publishSerializedNewMeta(
      ownerKey,
      this.files.serializeMeta(meta)
    );
  }

  private async publishSerializedNewMeta(
    ownerKey: string,
    serializedMeta: string
  ) {
    try {
      const publish = await publishMeta(
        this.files.metaPath(ownerKey),
        null,
        serializedMeta,
        { write: this.dependencies.atomicWrite }
      );
      if (publish === "not-published") {
        throw new BaseNotPublishedCommitError(this.files.metaPath(ownerKey));
      }
    } catch (cause) {
      if (cause instanceof BaseNotPublishedCommitError) throw cause;
      const ambiguous =
        cause instanceof BaseAmbiguousCommitError
          ? cause
          : new BaseAmbiguousCommitError(this.files.metaPath(ownerKey), cause);
      this.frozen.set(ownerKey, ambiguous);
      throw ambiguous;
    }
  }

  private async commitLocked(
    ownerKey: string,
    ownerInstanceId: string,
    input: BaseStoreMutation
  ) {
    const current = this.requireState(ownerKey, ownerInstanceId);
    if (input.meta.revision !== current.meta.revision + 1) {
      throw new Error("Base commit revision 必须恰好递增 1");
    }
    const generation = input.rowsChanged
      ? current.meta.rowsGeneration + 1
      : current.meta.rowsGeneration;
    let galleryChanged = Boolean(input.galleryChanged);
    let galleryInput = input.gallery;
    if (!galleryChanged) {
      const derived = deriveGalleryRemovals(
        current,
        { rows: input.rows, meta: input.meta },
        this.now()
      );
      if (derived) {
        galleryInput = derived;
        galleryChanged = !same(derived, current.gallery);
      }
    }
    const galleryGeneration = galleryChanged
      ? (current.meta.galleryGeneration ?? 0) + 1
      : current.meta.galleryGeneration ?? 0;
    let history: BaseHistoryLedger = current.history;
    try {
      history = appendHistoryEntry(
        current.history,
        historyEntry(
          current.rows,
          input.rows,
          this.now(),
          input.actor ?? "system",
          input.operation ?? "mutation"
        )
      );
    } catch (cause) {
      // 条目「生成」失败是有损审计的可接受降级：丢条目、业务照常。
      this.warn(
        `Base ${ownerKey} history 条目生成失败，业务提交继续：${errorMessage(cause)}`
      );
    }
    const historyChanged = history !== current.history;
    const historyGeneration = historyChanged
      ? (current.meta.historyGeneration ?? 0) + 1
      : current.meta.historyGeneration ?? 0;
    const meta = baseMetaSchema.parse({
      ...input.meta,
      owner: current.meta.owner,
      ownerInstanceId,
      rowsGeneration: generation,
      galleryGeneration,
      historyGeneration,
    });
    const rows = input.rows.map((row) => baseRowSchema.parse(row));
    const gallery = galleryChanged
      ? parseGalleryLedger(
          galleryInput,
          galleryOwnerId(meta),
          ownerInstanceId
        )
      : current.gallery;
    if (!galleryChanged && galleryInput && !same(galleryInput, current.gallery)) {
      throw new Error("galleryChanged=false 不允许修改 Gallery ledger");
    }
    this.validateState(meta, rows, gallery);

    if (input.rowsChanged) {
      await this.files.atomicWrite(
        this.files.rowsPath(ownerKey, generation),
        this.files.serializeRows(rows)
      );
    } else if (!same(rows, current.rows)) {
      throw new Error("meta-only commit 不允许修改 rows");
    }
    if (galleryChanged) {
      await this.files.atomicWrite(
        this.files.galleryPath(ownerKey, galleryGeneration),
        this.files.serializeGallery(gallery)
      );
    }
    // history 文件与 rows/gallery 同次原子发布同命运：写不下去就整单不提交，
    // 绝不留下「meta 说有第 N 代、磁盘上没有」的半提交态。
    if (historyChanged) {
      await this.files.atomicWrite(
        this.files.historyPath(ownerKey, historyGeneration),
        this.files.serializeHistory(history)
      );
    }
    try {
      const publish = await publishMeta(
        this.files.metaPath(ownerKey),
        this.files.serializeMeta(current.meta),
        this.files.serializeMeta(meta),
        { write: this.dependencies.atomicWrite }
      );
      if (publish === "not-published") {
        throw new BaseNotPublishedCommitError(this.files.metaPath(ownerKey));
      }
    } catch (cause) {
      if (cause instanceof BaseNotPublishedCommitError) throw cause;
      const ambiguous =
        cause instanceof BaseAmbiguousCommitError
          ? cause
          : new BaseAmbiguousCommitError(this.files.metaPath(ownerKey), cause);
      this.frozen.set(ownerKey, ambiguous);
      throw ambiguous;
    }
    const next = { meta, rows, gallery, history };
    this.states.set(ownerKey, next);
    if (input.rowsChanged || galleryChanged) {
      await this.gcAttachments(ownerKey, ownerInstanceId, rows);
    }
    await this.files
      .gcGenerations(
        ownerKey,
        generation,
        galleryGeneration,
        historyGeneration
      )
      .catch((cause) =>
        this.warn(`Base ${ownerKey} 旧世代清理失败：${errorMessage(cause)}`)
      );
    return this.snapshot(next);
  }

  private async gcAttachments(
    ownerKey: string,
    ownerInstanceId: string,
    rows: readonly import("../../../shared/bases-ipc").BaseRow[]
  ) {
    await this.attachments
      .gcFamily(
        ownerFileStem(ownerKey),
        ownerInstanceId,
        collectRowAttachmentBlobIds(rows)
      )
      .catch((cause) =>
        this.warn(`Base ${ownerKey} attachment GC 失败：${errorMessage(cause)}`)
      );
  }

  private async removeLocked(ownerKey: string, ownerInstanceId?: string) {
    this.assertOwnerKey(ownerKey);
    const state = this.states.get(ownerKey);
    if (
      state &&
      ownerInstanceId &&
      state.meta.ownerInstanceId !== ownerInstanceId
    ) {
      return false;
    }
    const blocked = this.startupBlocked.get(ownerKey);
    if (
      blocked &&
      ownerInstanceId &&
      blocked.ownerInstanceId !== ownerInstanceId
    ) {
      return false;
    }
    const tombstone = this.corrupt.get(ownerKey);
    if (
      tombstone?.ownerInstanceId &&
      ownerInstanceId &&
      tombstone.ownerInstanceId !== ownerInstanceId
    ) {
      return false;
    }
    if (!state && !blocked) {
      const diskMeta = await this.files.readMetaIfPresent(ownerKey);
      if (
        diskMeta &&
        ownerInstanceId &&
        diskMeta.ownerInstanceId !== ownerInstanceId
      ) {
        return false;
      }
    }
    await this.files.removeFamilyFiles(ownerKey);
    const instance =
      state?.meta.ownerInstanceId ??
      tombstone?.ownerInstanceId ??
      blocked?.ownerInstanceId ??
      ownerInstanceId;
    if (instance) {
      await this.attachments.releaseFamily(
        ownerFileStem(ownerKey),
        instance,
        "deleted-proven"
      );
    }
    this.states.delete(ownerKey);
    this.corrupt.delete(ownerKey);
    this.startupBlocked.delete(ownerKey);
    this.frozen.delete(ownerKey);
    return Boolean(state || tombstone || blocked);
  }

  private validateState(
    meta: BaseMeta,
    rows: import("../../../shared/bases-ipc").BaseRow[],
    gallery: BaseGalleryLedger
  ) {
    validateStoredBase(meta, rows, gallery, {
      meta: (value) => this.files.serializeMeta(value),
      rows: (value) => this.files.serializeRows(value),
      gallery: (value) => this.files.serializeGallery(value),
    });
  }

  private warn(message: string) {
    this.warnings.push(message);
  }
}

/** 无行差分（纯 meta 提交：切视图、拖列宽、改列名）返回 null——不烧历史世代。 */
function historyEntry(
  before: readonly import("../../../shared/bases-ipc").BaseRow[],
  after: readonly import("../../../shared/bases-ipc").BaseRow[],
  at: number,
  actor: BaseHistoryActor,
  operation: string
): BaseHistoryEntry | null {
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const afterById = new Map(after.map((row) => [row.id, row]));
  const rowIds = [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter((rowId) => !same(beforeById.get(rowId), afterById.get(rowId)))
    .slice(0, 500);
  if (!rowIds.length) return null;
  const cells = rowIds.flatMap((rowId) => {
    const left = beforeById.get(rowId)?.values ?? {};
    const right = afterById.get(rowId)?.values ?? {};
    const columnIds = [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .filter((columnId) => !same(left[columnId], right[columnId]))
      .slice(0, 64);
    return columnIds.length ? [{ rowId, columnIds }] : [];
  });
  return { at, actor, operation, rowIds, ...(cells.length ? { cells } : {}) };
}
